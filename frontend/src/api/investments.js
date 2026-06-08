import api from './client';

export const fetchInvestments = () =>
  api.get('/investments').then(r => r.data);

export const updateInvestmentValue = (id, currentValue) =>
  api.patch(`/investments/${id}/value`, { current_value: currentValue }).then(r => r.data);

export const updateContributed = (id, contributed) =>
  api.patch(`/investments/${id}/value`, { contributed }).then(r => r.data);

export const clearContributed = (id) =>
  api.patch(`/investments/${id}/value`, { clear_contributed: true }).then(r => r.data);

export const fetchHoldings = (accountId) =>
  api.get(`/investments/${accountId}/holdings`).then(r => r.data);

export const fetchTrades = (accountId, params = {}) =>
  api.get(`/investments/${accountId}/trades`, { params }).then(r => r.data);

export const fetchDividends = (accountId) =>
  api.get(`/investments/${accountId}/dividends`).then(r => r.data);

export const fetchPerformance = (accountId) =>
  api.get(`/investments/${accountId}/performance`).then(r => r.data);

export const patchHoldingPrice = (accountId, securityCode, price) =>
  api.patch(`/investments/holdings/${accountId}/${securityCode}/price`, { price }).then(r => r.data);

export const refreshPrices = (accountId) =>
  api.post(`/investments/${accountId}/refresh-prices`).then(r => r.data);
