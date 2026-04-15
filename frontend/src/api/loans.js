import api from './client';

export const fetchLoans = () => api.get('/loans').then(r => r.data);
export const fetchLoanSummary = (id) => api.get(`/loans/${id}/summary`).then(r => r.data);
export const fetchLoanHistory = (id) => api.get(`/loans/${id}/history`).then(r => r.data);
