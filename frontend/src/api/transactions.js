import api from './client';

export async function fetchTransactions({ accountId, txType, search, categorised, page = 1, perPage = 50 } = {}) {
  const params = { page, per_page: perPage };
  if (accountId) params.account_id = accountId;
  if (txType) params.tx_type = txType;
  if (search) params.search = search;
  if (categorised !== undefined && categorised !== null) params.categorised = categorised;
  const response = await api.get('/transactions', { params });
  return response.data;
}
