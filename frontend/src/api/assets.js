import api from './client';

export const fetchAssets = () => api.get('/assets').then(r => r.data);
export const createAsset = (payload) => api.post('/assets', payload).then(r => r.data);
export const updateAsset = (id, payload) => api.put(`/assets/${id}`, payload).then(r => r.data);
export const deleteAsset = (id) => api.delete(`/assets/${id}`);
