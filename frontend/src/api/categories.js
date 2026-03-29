/**
 * API functions for category CRUD operations.
 */

import api from './client';

export async function fetchCategories(type = null) {
  const params = type ? { category_type: type } : {};
  const response = await api.get('/categories', { params });
  return response.data;
}

export async function createCategory(data) {
  const response = await api.post('/categories', data);
  return response.data;
}

export async function updateCategory(id, data) {
  const response = await api.put(`/categories/${id}`, data);
  return response.data;
}

export async function deleteCategory(id) {
  await api.delete(`/categories/${id}`);
}
