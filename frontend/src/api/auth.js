import api from './client';

export const checkAuthStatus = () => api.get('/auth/status').then(r => r.data);
export const login = (username, password) => api.post('/auth/login', { username, password }).then(r => r.data);
export const setupUser = (username, password) => api.post('/auth/setup', { username, password }).then(r => r.data);
