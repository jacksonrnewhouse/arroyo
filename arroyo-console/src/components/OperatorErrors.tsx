import Loading from './Loading';
import { Table, TableContainer, Tbody, Td, Th, Thead, Tr } from '@chakra-ui/react';
import React from 'react';
import { formatDate } from '../lib/util';
import { OperatorErrorsRes } from '../gen/api_pb';

export interface OperatorErrorsProps {
  operatorErrors?: OperatorErrorsRes;
}

const OperatorErrors: React.FC<OperatorErrorsProps> = ({ operatorErrors }) => {
  if (!operatorErrors) {
    return <Loading />;
  }

  const tableBody = (
    <Tbody>
      {operatorErrors.messages.map(m => {
        return (
          <Tr key={String(m.createdAt)}>
            <Td>{formatDate(m.createdAt)}</Td>
            <Td>{m.operatorId}</Td>
            <Td>{m.taskIndex?.toString()}</Td>
            <Td>{m.message}</Td>
            <Td>{m.details}</Td>
          </Tr>
        );
      })}
    </Tbody>
  );

  const table = (
    <TableContainer padding={5}>
      <Table variant="striped" w={'100%'}>
        <Thead>
          <Tr>
            <Th>Time</Th>
            <Th>Operator</Th>
            <Th>Task Index</Th>
            <Th>Message</Th>
            <Th>Details</Th>
          </Tr>
        </Thead>
        {tableBody}
      </Table>
    </TableContainer>
  );

  if (operatorErrors && operatorErrors.messages.length == 0) {
    return <>No errors to display</>;
  }

  return <>{table}</>;
};

export default OperatorErrors;
