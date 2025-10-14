import axios from 'axios';

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api'
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error.response?.data?.error || error.message;
    return Promise.reject(new Error(message));
  }
);

export default client;
