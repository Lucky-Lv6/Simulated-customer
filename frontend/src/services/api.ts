const API_BASE = '/api';

export async function fetchCustomers() {
  const res = await fetch(`${API_BASE}/customers`);
  return res.json();
}

export async function fetchScenarios() {
  const res = await fetch(`${API_BASE}/scenarios`);
  return res.json();
}

export async function fetchVoices() {
  const res = await fetch(`${API_BASE}/voices`);
  return res.json();
}

export async function previewVoice(voiceId: string, text?: string) {
  const res = await fetch(`${API_BASE}/voices/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice_id: voiceId, text }),
  });
  return res.json();
}

export async function uploadMaterial(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/upload/material`, {
    method: 'POST',
    body: formData,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.detail || `上传失败 (HTTP ${res.status})`);
  }
  return data;
}

export async function fetchHistory() {
  const res = await fetch(`${API_BASE}/history`);
  return res.json();
}

export async function fetchConfig() {
  const res = await fetch(`${API_BASE}/config`);
  if (!res.ok) throw new Error(`加载配置失败 (HTTP ${res.status})`);
  return res.json();
}

export async function fetchReadme() {
  const res = await fetch(`${API_BASE}/readme`);
  if (!res.ok) throw new Error(`加载说明文档失败 (HTTP ${res.status})`);
  return res.json();
}

export function createConversationWs(): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const ws = new WebSocket(`${protocol}//${host}/ws/conversation`);
  return ws;
}

// ========== 知识库 API ==========

export async function fetchKnowledgeCategories() {
  const res = await fetch(`${API_BASE}/knowledge/categories`);
  return res.json();
}

export async function fetchKnowledgeItems(category?: string) {
  const params = category ? `?category=${encodeURIComponent(category)}` : '';
  const res = await fetch(`${API_BASE}/knowledge/items${params}`);
  return res.json();
}

export async function fetchKnowledgeSearch(query: string, category?: string) {
  const params = new URLSearchParams({ q: query });
  if (category) params.set('category', category);
  const res = await fetch(`${API_BASE}/knowledge/search?${params}`);
  return res.json();
}

export async function fetchKnowledgeItem(itemId: string) {
  const res = await fetch(`${API_BASE}/knowledge/item/${itemId}`);
  return res.json();
}

// ========== 自定义客户 API ==========

export async function createCustomCustomer(data: {
  name: string;
  company: string;
  gender: string;
  age: number;
  position: string;
  industry: string;
  personality: string;
}) {
  const res = await fetch(`${API_BASE}/custom/customer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}
