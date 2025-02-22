import { ConnectError } from '@bufbuild/connect-web';
import {
  Stack,
  Flex,
  Box,
  Text,
  Button,
  Alert,
  AlertDescription,
  AlertIcon,
  HStack,
  useDisclosure,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  FormControl,
  FormLabel,
  Input,
  FormHelperText,
  Select,
  Spacer,
  TabList,
  Tabs,
  Tab,
  TabPanels,
  TabPanel,
  Spinner,
} from '@chakra-ui/react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  BuiltinSink,
  CreatePipelineReq,
  CreateSqlJob,
  CreateUdf,
  GetPipelineReq,
  GetSinksReq,
  GetSourcesReq,
  GrpcOutputSubscription,
  JobDetailsReq,
  JobGraph,
  JobStatus,
  OutputData,
  PipelineGraphReq,
  SourceDef,
  StopType,
  UdfLanguage,
} from '../../gen/api_pb';
import { ApiClient } from '../../main';
import { Catalog } from './Catalog';
import { PipelineGraph } from './JobGraph';
import { PipelineOutputs } from './JobOutputs';
import { CodeEditor } from './SqlEditor';

type SqlOptions = {
  name?: string;
  parallelism?: number;
  sink?: number;
  checkpointMS?: number;
};

function useQuery() {
  const { search } = useLocation();

  return useMemo(() => new URLSearchParams(search), [search]);
}

type SinkOpt = {
  name: string;
  value:
    | {
        value: BuiltinSink;
        case: 'builtin';
      }
    | {
        value: string;
        case: 'user';
      };
};

type PreviewState = {
  id: string;
  status?: JobStatus;
  outputs?: Array<{ id: number; data: OutputData }>;
  active: boolean;
};

export function CreatePipeline({ client }: { client: ApiClient }) {
  const [sources, setSources] = useState<Array<SourceDef>>([]);
  const [sinks, setSinks] = useState<Array<SinkOpt>>([]);
  const [graph, setGraph] = useState<JobGraph | null>(null);
  const [query, setQuery] = useState<string>('');
  const [udfs, setUdfs] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [options, setOptions] = useState<SqlOptions>({ parallelism: 4, checkpointMS: 5000 });
  const navigate = useNavigate();
  const [startError, setStartError] = useState<string | null>(null);
  const [tabIndex, setTabIndex] = useState<number>(0);
  const [previewing, setPreviewing] = useState<PreviewState | null>(null);
  const [stopping, setStopping] = useState<boolean>(false);

  const queryParams = useQuery();

  const updateQuery = (query: string) => {
    window.localStorage.setItem('query', query);
    setQuery(query);
  };

  const updateUdf = (udf: string) => {
    window.localStorage.setItem('udf', udf);
    setUdfs(udf);
  };

  useEffect(() => {
    const copyFrom = queryParams.get('from');
    const fetch = async (copyFrom: string) => {
      const def = await (
        await client()
      ).getPipeline(
        new GetPipelineReq({
          pipelineId: copyFrom,
        })
      );

      setQuery(def.definition || '');
      setUdfs(def.udfs[0].definition || '');
      setOptions({
        ...options,
        name: def.name + '-copy',
      });
    };

    let savedQuery = window.localStorage.getItem('query');
    let savedUdfs = window.localStorage.getItem('udf');
    if (copyFrom != null) {
      fetch(copyFrom);
    } else {
      if (savedQuery != null) {
        setQuery(savedQuery);
      }
      if (savedUdfs != null) {
        setUdfs(savedUdfs);
      }
    }
  }, [queryParams]);

  useEffect(() => {
    const fetchData = async () => {
      const sources = (await client()).getSources(new GetSourcesReq({}));
      const sinks = (await client()).getSinks(new GetSinksReq({}));

      setSources((await sources).sources);

      let allSinks: Array<SinkOpt> = [
        { name: 'Web', value: { case: 'builtin', value: BuiltinSink.Web } },
        { name: 'Log', value: { case: 'builtin', value: BuiltinSink.Log } },
        { name: 'Null', value: { case: 'builtin', value: BuiltinSink.Null } },
      ];

      (await sinks).sinks.forEach(sink => {
        allSinks.push({
          name: sink.name,
          value: {
            case: 'user',
            value: sink.name,
          },
        });
      });

      setSinks(allSinks);
    };

    fetchData();
  }, []);

  const check = async (navigateTo: boolean) => {
    setGraph(null);
    setError(null);

    let resp = await (
      await client()
    ).graphForPipeline(
      new PipelineGraphReq({
        query: query,
        udfs: [new CreateUdf({ language: UdfLanguage.Rust, definition: udfs })],
      })
    );

    if (resp.result.case == 'jobGraph') {
      setGraph(resp.result.value);
      if (navigateTo) {
        setTabIndex(0);
      }
    } else if (resp.result.case == 'errors') {
      setError(resp.result.value.errors[0].message);
    }
  };

  const preview = async () => {
    await check(false);

    if (error != null) {
      return;
    }

    try {
      let resp = await (
        await client()
      ).previewPipeline(
        new CreatePipelineReq({
          //name: `preview-${new Date().getTime()}`,
          name: 'preview',
          config: {
            case: 'sql',
            value: new CreateSqlJob({
              query: query,
              udfs: [new CreateUdf({ language: UdfLanguage.Rust, definition: udfs })],
              sink: { case: 'builtin', value: BuiltinSink.Web },
              preview: true,
            }),
          },
        })
      );

      let ourPreviewing: PreviewState = { id: resp.jobId, active: false };
      setPreviewing(ourPreviewing);
      setTabIndex(1);

      while (ourPreviewing.status?.state != 'Running') {
        try {
          let details = await (
            await client()
          ).getJobDetails(
            new JobDetailsReq({
              jobId: resp.jobId,
            })
          );

          ourPreviewing = {
            id: resp.jobId,
            status: details.jobStatus,
            active: details.jobStatus?.state == 'Running',
          };
          setPreviewing(ourPreviewing);
        } catch (e) {
          console.log('failed to fetch job status', e);
        }

        await new Promise(r => setTimeout(r, 1000));
      }

      console.log('subscribing to output');
      let counter = 1;
      let outputs = [];
      for await (const res of (await client()).subscribeToOutput(
        new GrpcOutputSubscription({
          jobId: resp.jobId,
        })
      )) {
        let output = {
          id: counter++,
          data: res,
        };

        outputs.push(output);
        if (outputs.length > 100) {
          outputs.shift();
        }

        setPreviewing({ ...ourPreviewing, outputs: outputs, active: true });
      }

      console.log('Job finished');
      setPreviewing({ ...ourPreviewing, outputs: outputs, active: false });
    } catch (e) {
      if (e instanceof ConnectError) {
        setError(e.rawMessage);
      } else {
        setError('Something went wrong. Please try again.');
      }
    }
  };

  const stopPreview = async () => {
    if (previewing == null) {
      return;
    }

    setStopping(true);
    await (
      await client()
    ).updateJob({
      jobId: previewing.id,
      stop: StopType.Immediate,
    });

    while (true) {
      const details = await (await client()).getJobDetails({ jobId: previewing.id });

      if (details.jobStatus?.state == 'Stopped') {
        break;
      }
    }

    setPreviewing({ ...previewing, active: false });
    setStopping(false);
  };

  const run = async () => {
    await check(false);

    if (error == null) {
      onOpen();
    }
  };

  const start = async () => {
    try {
      let sink = sinks[options.sink!];

      let resp = await (
        await client()
      ).startPipeline(
        new CreatePipelineReq({
          name: options.name,
          config: {
            case: 'sql',
            value: new CreateSqlJob({
              query: query,
              udfs: [new CreateUdf({ language: UdfLanguage.Rust, definition: udfs })],
              sink: sink.value,
            }),
          },
        })
      );

      localStorage.removeItem('query');
      navigate(`/jobs/${resp.jobId}`);
    } catch (e) {
      if (e instanceof ConnectError) {
        setStartError(e.rawMessage);
      } else {
        setStartError('Something went wrong');
        console.log('Unhandled error', e);
      }
    }
  };

  return (
    <>
      <Box flex="1" height="100vh">
        <Stack spacing={4} h="100vh">
          <Flex direction="row" h="100vh">
            <Stack width={300} background="bg-subtle" p={2} spacing={6}>
              <Text fontSize="xl">Sources</Text>
              <Box overflowY="auto" overflowX="hidden">
                {sources.length == 0 ? (
                  <Text>
                    No sources have been configured. Create one <Link to="/sources/new">here</Link>.
                  </Text>
                ) : (
                  <Catalog sources={sources} />
                )}
              </Box>
            </Stack>
            <Stack flex={2} spacing={0}>
              <Box padding={5} pl={0} backgroundColor="#1e1e1e">
                <Tabs>
                  <TabList>
                    <Tab>query.sql</Tab>
                    <Tab>udfs.rs</Tab>
                  </TabList>
                  <TabPanels>
                    <TabPanel>
                      <CodeEditor query={query} setQuery={updateQuery}></CodeEditor>
                    </TabPanel>
                    <TabPanel>
                      <CodeEditor query={udfs} setQuery={updateUdf} language="rust"></CodeEditor>
                    </TabPanel>
                  </TabPanels>
                </Tabs>
              </Box>

              <HStack spacing={4} p={2} backgroundColor="gray.500">
                <Button
                  size="sm"
                  colorScheme="blue"
                  onClick={() => check(true)}
                  title="Check that the SQL is valid"
                  borderRadius={2}
                >
                  Check
                </Button>
                <Button
                  size="sm"
                  colorScheme="blue"
                  onClick={previewing == null || !previewing.active ? preview : stopPreview}
                  title="Run a preview pipeline"
                  borderRadius={2}
                  isLoading={
                    (previewing != null &&
                      previewing.status?.state != 'Running' &&
                      !previewing.active) ||
                    stopping
                  }
                  loadingText={stopping ? 'stopping' : previewing?.status?.state}
                >
                  {previewing == null || !previewing.active ? 'Preview' : 'Stop preview'}
                </Button>
                <Spacer />
                <Button size="sm" colorScheme="green" onClick={run} borderRadius={2}>
                  Start Pipeline
                </Button>
              </HStack>
              {error != null ? (
                <Alert status="error">
                  <AlertIcon />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <Tabs index={tabIndex} onChange={i => setTabIndex(i)} height="100%">
                <TabList>
                  <Tab>Pipeline</Tab>
                  <Tab>
                    <HStack>
                      <Text>Results</Text>
                      {previewing?.active ? <Spinner size="xs" speed="0.9s" /> : null}
                    </HStack>
                  </Tab>
                </TabList>

                <TabPanels height="calc(100% - 40px)">
                  <TabPanel height="100%" position="relative">
                    {graph != null ? (
                      <Box
                        style={{ top: 0, bottom: 0, left: 0, right: 0, position: 'absolute' }}
                        overflow="auto"
                      >
                        <PipelineGraph graph={graph} setActiveOperator={() => {}} />
                      </Box>
                    ) : (
                      <Text>check your SQL to see the pipeline graph</Text>
                    )}
                  </TabPanel>
                  <TabPanel overflowX="auto" height="100%" position="relative">
                    {previewing?.outputs != null ? (
                      <Box
                        style={{ top: 0, bottom: 0, left: 0, right: 0, position: 'absolute' }}
                        overflow="auto"
                      >
                        <PipelineOutputs outputs={previewing?.outputs} />
                      </Box>
                    ) : previewing != null ? (
                      <Text>launching preview pipeline...</Text>
                    ) : (
                      <Text>preview your SQL to see outputs</Text>
                    )}
                  </TabPanel>
                </TabPanels>
              </Tabs>
            </Stack>
          </Flex>
        </Stack>
      </Box>

      <Modal isOpen={isOpen} onClose={onClose} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Start Pipeline</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Stack spacing={8}>
              {startError ? (
                <Alert status="error">
                  <AlertIcon />
                  <AlertDescription>{startError}</AlertDescription>
                </Alert>
              ) : null}

              <FormControl>
                <FormLabel>Name</FormLabel>
                <Input
                  type="text"
                  value={options.name || ''}
                  onChange={v => setOptions({ ...options, name: v.target.value })}
                />
                <FormHelperText>Give this pipeline a name to help you identify it</FormHelperText>
              </FormControl>
              <FormControl>
                <FormLabel>Sink</FormLabel>
                <Select
                  variant="filled"
                  value={options.sink}
                  onChange={v =>
                    setOptions({
                      ...options,
                      sink: v.target.value ? Number(v.target.value) : undefined,
                    })
                  }
                  placeholder="Select sink"
                >
                  {sinks.map((s, i) => (
                    <option key={s.name} value={i}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                <FormHelperText>Choose where the outputs of the pipeline will go</FormHelperText>
              </FormControl>
            </Stack>
          </ModalBody>

          <ModalFooter>
            <Button mr={3} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={start}
              isDisabled={options.name == '' || options.parallelism == null || options.sink == null}
            >
              Start
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
