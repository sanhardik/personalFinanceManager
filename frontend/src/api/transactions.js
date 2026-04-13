import api from './client';

export async function fetchTransactions({ accountId, txType, search, categorised, categoryId, sortBy, sortDir, uncategorisedFirst = true, page = 1, perPage = 50 } = {}) {
  const params = { page, per_page: perPage };
  if (accountId) params.account_id = accountId;
  if (txType) params.tx_type = txType;
  if (search) params.search = search;
  if (categorised !== undefined && categorised !== null) params.categorised = categorised;
  if (categoryId !== undefined && categoryId !== null) params.category_id = categoryId;
  if (sortBy) params.sort_by = sortBy;
  if (sortDir) params.sort_dir = sortDir;
  if (!uncategorisedFirst) params.uncategorised_first = false;
  const response = await api.get('/transactions', { params });
  return response.data;
}

export const patchTransaction = (id, data) => api.patch(`/transactions/${id}`, data).then(r => r.data);
export const bulkCategorise = (transaction_ids, category_id) =>
  api.post('/transactions/bulk-categorise', { transaction_ids, category_id }).then(r => r.data);
