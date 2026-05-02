import api from './client';

export async function fetchAccounts() {
  const response = await api.get('/accounts');
  return response.data;
}

export async function fetchAccountsSummary() {
  const response = await api.get('/accounts/summary');
  return response.data;
}

export async function createAccount(data) {
  const response = await api.post('/accounts', data);
  return response.data;
}

export async function updateAccount(id, data) {
  const response = await api.put(`/accounts/${id}`, data);
  return response.data;
}

export async function deleteAccount(id) {
  await api.delete(`/accounts/${id}`);
}
