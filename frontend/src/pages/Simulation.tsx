import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Loader2, Mic, Play, Upload } from 'lucide-react';
import {
  createCustomCustomer,
  fetchCustomers,
  fetchScenarios,
  fetchVoices,
  previewVoice,
  uploadMaterial,
} from '../services/api';
import { playHexAudio } from '../utils/audio';
import type { CustomerProfile, Scenario, UploadResult, Voice } from '../types';

const difficulties = [
  { value: 1, label: 'Lv1', desc: '入门 - 简单问答' },
  { value: 2, label: 'Lv2', desc: '基础 - 标准对话' },
  { value: 3, label: 'Lv3', desc: '进阶 - 复杂场景' },
  { value: 4, label: 'Lv4', desc: '挑战 - 深度沟通' },
  { value: 5, label: 'Lv5', desc: '极限 - 高压谈判' },
];

export default function Simulation() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [selectedScenario, setSelectedScenario] = useState('');
  const [selectedDifficulty, setSelectedDifficulty] = useState(3);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [uploadedFile, setUploadedFile] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);

  // 自定义客户状态
  const [customerTab, setCustomerTab] = useState<'preset' | 'custom'>('preset');
  const [customForm, setCustomForm] = useState({
    name: '',
    company: '',
    gender: 'male',
    age: 35,
    position: '',
    industry: '',
    personality: '友好',
  });
  const [customCustomerId, setCustomCustomerId] = useState<string | null>(null);
  const [customVoiceId, setCustomVoiceId] = useState<string | null>(null);
  const [customVoiceName, setCustomVoiceName] = useState('');
  const [creatingCustom, setCreatingCustom] = useState(false);
  const [customError, setCustomError] = useState('');

  const handlePreview = async (voiceId: string) => {
    if (!voiceId) return;
    setPreviewing(voiceId);
    try {
      const result = await previewVoice(voiceId, '您好，我是AI客户模拟助手，很高兴为您服务。');
      if (!(await playHexAudio(result?.audio))) {
        setUploadError('试听失败：TTS 服务未返回音频');
      }
    } catch {
      setUploadError('试听失败：TTS 服务不可用');
    } finally {
      setTimeout(() => setPreviewing(null), 1500);
    }
  };

  useEffect(() => {
    Promise.all([
      fetchCustomers(),
      fetchScenarios(),
      fetchVoices(),
    ])
      .then(([customersData, scenariosData, voicesData]) => {
        const c: CustomerProfile[] = Array.isArray(customersData) ? customersData : [];
        const s: Scenario[] = Array.isArray(scenariosData) ? scenariosData : [];
        const v: Voice[] = Array.isArray(voicesData) ? voicesData : [];
        setCustomers(c);
        setScenarios(s);
        setVoices(v);
        if (c.length) setSelectedCustomer(c[0].id);
        if (s.length) setSelectedScenario(s[0].id);
        if (v.length) {
          // 优先使用「声音中心」里选定的默认声音
          const preferred = sessionStorage.getItem('selected_voice');
          const hit = v.find((item) => item.id === preferred);
          setSelectedVoice(hit ? hit.id : v[0].id);
        }
      })
      .catch(() => setLoadError('配置数据加载失败，请确认后端服务已启动（默认端口 8765）'))
      .finally(() => setLoading(false));
  }, []);

  const isSupportedFile = (file: File) =>
    /\.(txt|md|docx|pdf)$/i.test(file.name);

  const handleFileUpload = useCallback(async (file: File) => {
    if (!file) return;
    if (!isSupportedFile(file)) {
      setUploadError(`不支持的文件格式：${file.name}（支持 TXT / MD / DOCX / PDF）`);
      setUploadedFile(null);
      return;
    }

    setUploading(true);
    setUploadError('');
    try {
      const result = await uploadMaterial(file);
      if (!result || result.error || !result.text) {
        throw new Error(result?.error || '资料解析失败');
      }
      // 关键：新上传必须整体替换旧资料，避免继续使用上一次的内容
      setUploadedFile(result as UploadResult);
    } catch (e: any) {
      // 解析失败时清空旧资料，绝不能静默继续使用上一次上传的内容
      setUploadedFile(null);
      setUploadError(`资料解析失败：${e?.message || String(e)}`);
    } finally {
      setUploading(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  }, [handleFileUpload]);

  const handleCreateCustom = async () => {
    if (!customForm.name.trim()) {
      setCustomError('请输入客户姓名');
      return;
    }
    setCreatingCustom(true);
    setCustomError('');
    try {
      const result = await createCustomCustomer(customForm);
      if (result?.customer) {
        setCustomCustomerId(result.customer.id);
        if (result.recommended_voice) {
          setCustomVoiceId(result.recommended_voice.voice_id);
          setCustomVoiceName(result.recommended_voice.voice_name || '');
          setSelectedVoice(result.recommended_voice.voice_id);
        }
      }
    } catch {
      setCustomError('创建失败，请稍后重试');
    } finally {
      setCreatingCustom(false);
    }
  };

  const handleFormChange = (field: string, value: string | number) => {
    setCustomForm((prev) => ({ ...prev, [field]: value }));
    // 性别或年龄变化时，清除已创建的自定义客户
    if (field === 'gender' || field === 'age') {
      setCustomCustomerId(null);
      setCustomVoiceId(null);
    }
  };

  const handleStart = () => {
    const config = {
      customer_id: customerTab === 'custom' && customCustomerId ? customCustomerId : selectedCustomer,
      scenario_id: selectedScenario,
      difficulty: selectedDifficulty,
      voice_id: customerTab === 'custom' && customVoiceId ? customVoiceId : selectedVoice,
      uploaded_text: uploadedFile?.text || '',
      uploaded_filename: uploadedFile?.filename || '',
      uploaded_material_id: uploadedFile?.material_id || '',
      uploaded_script_lines: uploadedFile?.script_lines || [],
    };
    sessionStorage.setItem('simulation_config', JSON.stringify(config));
    navigate('/conversation');
  };

  const isValid = customerTab === 'custom'
    ? !!(customCustomerId && selectedScenario && (customVoiceId || selectedVoice))
    : !!(selectedCustomer && selectedScenario && selectedVoice);

  if (loading) {
    return (
      <div className="page-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Loader2 size={32} style={{ color: '#3b82f6', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 800, margin: '0 auto' }}>
      <h1 className="page-title">模拟配置</h1>
      <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginBottom: 32, marginTop: -16 }}>
        配置客户角色、场景和难度，开始模拟训练
      </p>

      {loadError && (
        <div
          className="card"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 20,
            color: '#fca5a5',
            borderColor: 'rgba(239,68,68,0.3)',
            fontSize: '0.8125rem',
          }}
        >
          <AlertTriangle size={16} />
          {loadError}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Customer Selector */}
        <div className="card">
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#f1f5f9', marginBottom: 8 }}>
            客户角色
          </label>
          {/* Tab Switcher */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 12, background: 'rgba(148,163,184,0.08)', borderRadius: 8, padding: 3 }}>
            <button
              onClick={() => setCustomerTab('preset')}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 6, border: 'none',
                cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 500,
                background: customerTab === 'preset' ? 'rgba(59,130,246,0.2)' : 'transparent',
                color: customerTab === 'preset' ? '#f1f5f9' : '#94a3b8',
              }}
            >
              预设客户
            </button>
            <button
              onClick={() => setCustomerTab('custom')}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 6, border: 'none',
                cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 500,
                background: customerTab === 'custom' ? 'rgba(59,130,246,0.2)' : 'transparent',
                color: customerTab === 'custom' ? '#f1f5f9' : '#94a3b8',
              }}
            >
              自定义客户
            </button>
          </div>

          {customerTab === 'preset' ? (
            <>
              <select
                className="select"
                value={selectedCustomer}
                onChange={(e) => setSelectedCustomer(e.target.value)}
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} - {c.position} @ {c.company}
                  </option>
                ))}
              </select>
              {selectedCustomer && (() => {
                const customer = customers.find((c) => c.id === selectedCustomer);
                return customer ? (
                  <div
                    style={{
                      marginTop: 12,
                      padding: '10px 14px',
                      background: 'rgba(148,163,184,0.05)',
                      borderRadius: 8,
                      fontSize: '0.8125rem',
                      color: '#94a3b8',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span className="badge badge-blue">{customer.industry}</span>
                      <span className="badge badge-purple">{customer.technical_level}</span>
                      {customer.pain_points.slice(0, 2).map((p) => (
                        <span key={p} className="badge badge-orange">{p}</span>
                      ))}
                    </div>
                    <div style={{ marginTop: 8 }}>{customer.personality}</div>
                  </div>
                ) : null;
              })()}
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <input
                  className="input"
                  placeholder="客户姓名 *"
                  value={customForm.name}
                  onChange={(e) => handleFormChange('name', e.target.value)}
                />
                <input
                  className="input"
                  placeholder="所属公司"
                  value={customForm.company}
                  onChange={(e) => handleFormChange('company', e.target.value)}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <select
                  className="select"
                  value={customForm.gender}
                  onChange={(e) => handleFormChange('gender', e.target.value)}
                >
                  <option value="male">男</option>
                  <option value="female">女</option>
                </select>
                <input
                  className="input"
                  type="number"
                  placeholder="年龄"
                  value={customForm.age}
                  onChange={(e) => handleFormChange('age', parseInt(e.target.value) || 30)}
                  min={18}
                  max={80}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <input
                  className="input"
                  placeholder="职位"
                  value={customForm.position}
                  onChange={(e) => handleFormChange('position', e.target.value)}
                />
                <input
                  className="input"
                  placeholder="行业"
                  value={customForm.industry}
                  onChange={(e) => handleFormChange('industry', e.target.value)}
                />
              </div>
              <input
                className="input"
                placeholder="性格特点（如: 理性、谨慎、友好）"
                value={customForm.personality}
                onChange={(e) => handleFormChange('personality', e.target.value)}
              />
              {customError && (
                <div style={{ color: '#ef4444', fontSize: '0.8125rem' }}>{customError}</div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  className="btn btn-primary"
                  onClick={handleCreateCustom}
                  disabled={creatingCustom || !customForm.name.trim()}
                  style={{ flexShrink: 0 }}
                >
                  {creatingCustom ? (
                    <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  ) : null}
                  {customCustomerId ? '已创建 ✓' : '创建客户'}
                </button>
                {customVoiceId && customVoiceName && (
                  <span style={{ fontSize: '0.8125rem', color: '#10b981' }}>
                    已自动选择声音: {customVoiceName}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Scenario Selector */}
        <div className="card">
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#f1f5f9', marginBottom: 8 }}>
            场景选择
          </label>
          <select
            className="select"
            value={selectedScenario}
            onChange={(e) => setSelectedScenario(e.target.value)}
          >
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {selectedScenario && (() => {
            const scenario = scenarios.find((s) => s.id === selectedScenario);
            return scenario ? (
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 14px',
                  background: 'rgba(148,163,184,0.05)',
                  borderRadius: 8,
                  fontSize: '0.8125rem',
                  color: '#94a3b8',
                }}
              >
                <div>{scenario.description}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {scenario.tags.map((t) => (
                    <span key={t} className="badge badge-blue">{t}</span>
                  ))}
                </div>
              </div>
            ) : null;
          })()}
        </div>

        {/* Difficulty Selector */}
        <div className="card">
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#f1f5f9', marginBottom: 12 }}>
            难度等级
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {difficulties.map((d) => (
              <button
                key={d.value}
                onClick={() => setSelectedDifficulty(d.value)}
                className="btn"
                style={{
                  flex: 1,
                  minWidth: 120,
                  padding: '12px 16px',
                  background: selectedDifficulty === d.value
                    ? 'linear-gradient(135deg, rgba(59,130,246,0.2), rgba(139,92,246,0.15))'
                    : 'rgba(148,163,184,0.05)',
                  border: selectedDifficulty === d.value
                    ? '1px solid rgba(59,130,246,0.3)'
                    : '1px solid rgba(148,163,184,0.1)',
                  color: selectedDifficulty === d.value ? '#f1f5f9' : '#94a3b8',
                  flexDirection: 'column',
                  gap: 4,
                  height: 'auto',
                }}
              >
                <span style={{ fontWeight: 600 }}>{d.label}</span>
                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{d.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Voice Selector */}
        <div className="card">
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#f1f5f9', marginBottom: 8 }}>
            声音选择
          </label>
          <div style={{ display: 'flex', gap: 12 }}>
            <select
              className="select"
              value={selectedVoice}
              onChange={(e) => setSelectedVoice(e.target.value)}
              style={{ flex: 1 }}
            >
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} - {v.description}
                </option>
              ))}
            </select>
            <button
              className="btn btn-secondary"
              style={{ flexShrink: 0 }}
              onClick={() => handlePreview(selectedVoice)}
              disabled={previewing === selectedVoice}
            >
              {previewing === selectedVoice ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={14} />}
              {previewing === selectedVoice ? '播放中' : '试听'}
            </button>
          </div>
        </div>

        {/* Text Upload */}
        <div className="card">
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#f1f5f9', marginBottom: 8 }}>
            资料上传（可选）
          </label>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? 'rgba(59,130,246,0.5)' : 'rgba(148,163,184,0.15)'}`,
              borderRadius: 12,
              padding: 32,
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 200ms ease',
              background: dragOver ? 'rgba(59,130,246,0.05)' : 'transparent',
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.docx,.pdf"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
                // 允许再次选择同一个文件（内容更新后文件名不变的情况）
                e.target.value = '';
              }}
            />
            {uploading ? (
              <Loader2 size={28} style={{ color: '#3b82f6', animation: 'spin 1s linear infinite', margin: '0 auto 8px' }} />
            ) : uploadedFile ? (
              <CheckCircle2 size={28} style={{ color: '#10b981', margin: '0 auto 8px' }} />
            ) : (
              <Upload size={28} style={{ color: '#64748b', margin: '0 auto 8px' }} />
            )}
            <div style={{ fontSize: '0.875rem', color: '#94a3b8', marginTop: 8 }}>
              {uploadedFile
                ? `已上传: ${uploadedFile.filename}`
                : '拖拽文件到此处，或点击上传'
              }
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 4 }}>
              支持 TXT、MD、DOCX、PDF 格式
            </div>
          </div>
          {uploadError && (
            <div
              style={{
                marginTop: 12,
                padding: '10px 14px',
                background: 'rgba(239,68,68,0.1)',
                borderRadius: 8,
                fontSize: '0.8125rem',
                color: '#fca5a5',
              }}
            >
              {uploadError}
            </div>
          )}
          {uploadedFile && (
            <div
              style={{
                marginTop: 12,
                padding: '10px 14px',
                background: 'rgba(16,185,129,0.1)',
                borderRadius: 8,
                fontSize: '0.8125rem',
                color: '#10b981',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <CheckCircle2 size={14} />
              <span>
                已解析文本内容（{uploadedFile.text.length} 字符
                {uploadedFile.material_id ? `，资料ID ${uploadedFile.material_id}` : ''}）
                {uploadedFile.script_lines?.length
                  ? ` · 识别到 ${uploadedFile.script_lines.length} 组「我/客户」台词，将逐字回应`
                  : ' · 未识别到「客户：」台词标记，将按动态模式交流'}
              </span>
              <button
                className="btn btn-ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  setUploadedFile(null);
                  setUploadError('');
                }}
                style={{ marginLeft: 'auto', padding: '2px 8px', height: 'auto', fontSize: '0.75rem', color: '#94a3b8' }}
              >
                清除资料
              </button>
            </div>
          )}
        </div>

        {/* Start Button */}
        <button
          className="btn btn-primary btn-lg"
          onClick={handleStart}
          disabled={!isValid}
          style={{
            width: '100%',
            marginTop: 8,
            fontSize: '1rem',
            gap: 10,
            padding: '16px 28px',
          }}
        >
          <Mic size={20} />
          开始模拟对话
        </button>
      </div>
    </div>
  );
}

