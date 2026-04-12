import api from './client';

export const fetchRules = () => api.get('/rules').then(r => r.data);
export const createRule = (data) => api.post('/rules', data).then(r => r.data);
export const updateRule = (id, data) => api.put(`/rules/${id}`, data).then(r => r.data);
export const deleteRule = (id) => api.delete(`/rules/${id}`);
export const applyRules = () => api.post('/rules/apply').then(r => r.data);
export const fetchAffected = (id) => api.get(`/rules/${id}/affected`).then(r => r.data);
export const recategoriseByRule = (id) => api.post(`/rules/${id}/recategorise`).then(r => r.data);

// Suggested rules (learning queue)
export const fetchSuggestions = () => api.get('/rules/suggestions').then(r => r.data);
export const acceptSuggestion = (id) => api.post(`/rules/suggestions/${id}/accept`).then(r => r.data);
export const dismissSuggestion = (id) => api.post(`/rules/suggestions/${id}/dismiss`);
