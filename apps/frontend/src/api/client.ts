import axios from 'axios';

const DEFAULT_API_BASE = '/api';

const normalizeApiBaseUrl = (value?: string) => {
  if (!value) {
    return DEFAULT_API_BASE;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_API_BASE;
  }

  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');

  if (/^https?:\/\//i.test(withoutTrailingSlash)) {
    try {
      const url = new URL(withoutTrailingSlash);
      if (url.pathname === '' || url.pathname === '/') {
        url.pathname = DEFAULT_API_BASE;
      }
      return url.toString().replace(/\/+$/, '');
    } catch {
      return withoutTrailingSlash || DEFAULT_API_BASE;
    }
  }

  if (withoutTrailingSlash === '' || withoutTrailingSlash === '/') {
    return DEFAULT_API_BASE;
  }

  return withoutTrailingSlash.startsWith('/')
    ? withoutTrailingSlash
    : `${DEFAULT_API_BASE}/${withoutTrailingSlash}`;
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
