import api from './client';

export async function uploadCSV(file, bank = null) {
  const formData = new FormData();
  formData.append('file', file);
  if (bank) formData.append('bank', bank);
  const response = await api.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000, // 60s for large files
  });
  return response.data;
}

// Returns [{name, description, required_headers}, ...]
export async function fetchSupportedBanks() {
  const response = await api.get('/upload/banks');
  return response.data;
}
