import api from './client';

export const fetchInvestments = () =>
  api.get('/investments').then(r => r.data);

export const updateInvestmentValue = (id, currentValue) =>
  api.patch(`/investments/${id}/value`, { current_value: currentValue }).then(r => r.data);
