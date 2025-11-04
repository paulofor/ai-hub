import axios from 'axios';

const normalizeApiBaseUrl = (value?: string) => {
  if (!value) {
    return '/api/api';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '/api/api';
  }

  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');

  if (/^https?:\/\//i.test(withoutTrailingSlash)) {
    try {
      const url = new URL(withoutTrailingSlash);
      if (url.pathname === '' || url.pathname === '/') {
        url.pathname = '/api/api';
      }
      return url.toString().replace(/\/+$/, '');
    } catch {
      return withoutTrailingSlash || '/api/api';
    }
  }

  if (withoutTrailingSlash === '' || withoutTrailingSlash === '/') {
    return '/api/api';
  }

  return withoutTrailingSlash.startsWith('/')
    ? withoutTrailingSlash
    : `/api/api/${withoutTrailingSlash}`;
};

const client = axios.create({
  baseURL: normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL)
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error.response?.data?.error || error.message;
    return Promise.reject(new Error(message));
  }
);

export default client;
