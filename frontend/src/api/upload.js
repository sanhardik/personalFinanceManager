import api from './client';

/**
 * Detect bank + accounts in a CSV without inserting anything.
 * Returns { bank_name, accounts: [{account_number, account_name, account_type}], row_count }
 */
export async function detectCSV(file) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await api.post('/upload/detect', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
}

/**
 * Upload a CSV and insert transactions.
 * @param {File} file - the CSV file
 * @param {string|null} bank - optional bank name to validate against
 * @param {number|null} accountId - optional existing account ID to use for all transactions
 */
export async function uploadCSV(file, bank = null, accountId = null) {
  const formData = new FormData();
  formData.append('file', file);
  if (bank) formData.append('bank', bank);
  if (accountId) formData.append('account_id', accountId);
  const response = await api.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
  return response.data;
}

// Returns [{name, description, required_headers}, ...]
export async function fetchSupportedBanks() {
  const response = await api.get('/upload/banks');
  return response.data;
}
