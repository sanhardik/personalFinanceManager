import api from './client';

const dates = (dateFrom, dateTo) => ({ date_from: dateFrom, date_to: dateTo });

export const fetchDashboardSummary = (dateFrom, dateTo) =>
  api.get('/dashboard/summary', { params: dates(dateFrom, dateTo) }).then(r => r.data);

export const fetchDashboardMonthly = (dateFrom, dateTo) =>
  api.get('/dashboard/monthly', { params: dates(dateFrom, dateTo) }).then(r => r.data);

export const fetchDashboardByCategory = (txType, dateFrom, dateTo) =>
  api.get('/dashboard/by-category', { params: { tx_type: txType, ...dates(dateFrom, dateTo) } }).then(r => r.data);

export const fetchUploadReminders = () =>
  api.get('/dashboard/upload-reminders').then(r => r.data);
