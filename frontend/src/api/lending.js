import api from './client';

export const fetchLoans = () => api.get('/lending').then(r => r.data);
export const fetchPortfolioSummary = () => api.get('/lending/summary').then(r => r.data);
export const createLoan = (data) => api.post('/lending', data).then(r => r.data);
export const updateLoan = (id, data) => api.put(`/lending/${id}`, data).then(r => r.data);
export const deleteLoan = (id) => api.delete(`/lending/${id}`);
export const fetchSchedule = (id) => api.get(`/lending/${id}/schedule`).then(r => r.data);
export const fetchLoanTransactions = (id) => api.get(`/lending/${id}/transactions`).then(r => r.data);
