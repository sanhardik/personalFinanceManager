import api from './client';

export async function uploadCSV(file) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await api.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000, // 60s for large files
  });
  return response.data;
}

export async function fetchSupportedBanks() {
  const response = await api.get('/upload/banks');
  return response.data;
}
