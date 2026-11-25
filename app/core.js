/**
 * api.js —— bluebee 接口封装
 * 所有路径与参数均从 app-service.js 逆向确认
 */

const API = (() => {
  const KEY = 'bbmini_state';

  // 真实服务器（从授权二维码得到）
  const REAL_BASE = 'https://platform.bluebeecloud.com/api';

  // 浏览器端走本地代理避免 CORS：/api → 后端自动转发
  const KNOWN_BASE = (typeof location !== 'undefined' &&
                      /^https?:/.test(location.protocol))
                     ? (location.origin + '/api')
                     : REAL_BASE;

  // content_id / parameter_id 常量
  const CFG = {
    CONTENT_WO: 108,      // 工单表
    PARAM_PM: 2,          // 预防性维护
    FILTER_IN_PROGRESS: 40,   // 进行中的工单
    FILTER_OVERDUE: 48,       // 过期未完成的工单
    FIELD_PLAN_TIME: 692,     // 安排时间
    FIELD_CODE: 689,          // 工单代码
    FIELD_DESC: 690,          // 工单描述
    FIELD_STATUS: 704,        // 工单状态
    PARAM_FIELD: 517,         // 参数字段（工单类型/工作类型）
    PARAM_CONTENT: 341,       // 参数来源内容 id
  };

  // 工单状态（从筛选配置 + App 截图推出）
  // 只保留两个状态（按需求）
  const WORKFLOW = [
    { id: 70, name: '进行中 In Progress', color: '#F5D419' },
    { id: 73, name: '已完成 Completed',   color: '#8BC34A' }
  ];

  // 不显示的人员（按要求隐藏）
  const HIDDEN_USERS = ['刘方鹏', '周随民', '郑建宏', '熊忠伟', '祝晓欣', '刘恒'];

  // 责任人名单（content_id=92, field_id=592，与 App 下拉一致）
  const USERS = [
    { id: 5,  name: '郭旺城' },
    { id: 6,  name: '曾杨崴' },
    { id: 8,  name: '温易达' },
    { id: 9,  name: '曾维东' },
    { id: 10, name: '胡健威' },
    { id: 11, name: '李宏俊' },
    { id: 12, name: '陈中仪' },
    { id: 13, name: '徐海航' },
  ];

  let _userCache = null;

  /** 拉取人员选项 */
  async function fetchUsers(dataId, key) {
    const d = await req('content/detail/headline-options', {
      params: {
        content_id: 92,
        field_id: 592,
        data_id: dataId,
        key: key || ''
      }
    });
    const ok = d && (d.success || (typeof d.status === 'string' && d.status.indexOf('10_000_') === 0));
    if (!ok) return USERS.slice();
    const list = (d.data || [])
      .filter(u => u && u.name && HIDDEN_USERS.indexOf(u.name) < 0)
      .map(u => ({ id: Number(u.id), name: u.name }));
    return list.length ? list : USERS.slice();
  }

  /**
   * 拉取工单可切换的状态
   * 服务器会按当前用户/工单权限返回可选项
   */
  async function fetchWorkflowOptions(dataId) {
    // 只用「进行中 / 已完成」两项
    return WORKFLOW.map(w => ({
      id: w.id,
      name: w.name,
      color: w.color,
      canNote: true
    }));
  }

  /**
   * 详情值的直接字段（headline-data 返回的 18 个）
   * 这些 ID 与 display-field 的展示字段 ID 不同，直接按 ID 取
   */
  const HEADLINE_FIELDS = [
    { field_id: 689, label: '工单代码',      type: 'text' },
    { field_id: 704, label: '工单状态',      type: 'workflow', editable: true },
    { field_id: 700, label: '设备代码',      type: 'entity' },
    { field_id: 701, label: '设备描述',      type: 'entity' },
    { field_id: 690, label: '工单描述',      type: 'text', editable: true },
    { field_id: 702, label: '工单类型（主项）', type: 'entity' },
    { field_id: 2530, label: '工作类型（小项）', type: 'entity' },
    { field_id: 703, label: '工作分类',      type: 'entity' },
    { field_id: 697, label: '优先级',        type: 'entity' },
    { field_id: 2093, label: '负责岗位',      type: 'entity' },
    { field_id: 692, label: '安排时间',      type: 'dateTime' },
    { field_id: 693, label: '目标时间',      type: 'dateTime' },
    { field_id: 2485, label: '是否需要职安健审批', type: 'switch' },
    { field_id: 694, label: '工单开始时间',    type: 'dateTime', worktime: true },
    { field_id: 695, label: '工单结束时间',    type: 'dateTime', worktime: true },
    { field_id: 1558, label: '停机时间(h)',   type: 'decimal', editable: true },
    { field_id: 705, label: '父工单代码',      type: 'select' },
    { field_id: 1821, label: '工单说明',      type: 'textarea', editable: true },
    { field_id: 2518, label: '备注',        type: 'textarea', editable: true },
    { field_id: 2531, label: '责任人',        type: 'user', editable: true },
    { field_id: 1559, label: '维修时间',      type: 'decimal', editable: true },
    { field_id: 1560, label: '计划总工时',     type: 'decimal', editable: true },
    { field_id: 699, label: '区域',        type: 'entity' },
    { field_id: 698, label: '成本中心描述',    type: 'entity' },
    { field_id: 688, label: '组织',        type: 'entity' },
    { field_id: 2190, label: 'bluebee创建时间', type: 'dateTime' },
  ];

  const state = {
    baseUrl: KNOWN_BASE,
    token: '',
    tokenId: '',
    userName: '',
    password: '',
    email: '',
    contentId: null,
    parameterId: null,
    menuRaw: null
  };

  /* ---------- 持久化 ---------- */
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || '{}');
      Object.assign(state, s);
    } catch (e) {}
    return state;
  }
  function clear() {
    localStorage.removeItem(KEY);
    state.token = ''; state.tokenId = ''; state.userName = '';
  }

  /* ---------- 请求 ---------- */
  async function req(path, opts = {}) {
    const { method = 'GET', params, body } = opts;
    let url = state.baseUrl.replace(/\/$/, '') + '/' + path.replace(/^\//, '');

    if (method === 'GET' && params) {
      const qs = new URLSearchParams();
      Object.keys(params).forEach(k => {
        const v = params[k];
        if (v !== undefined && v !== null && v !== '') qs.append(k, v);
      });
      const s = qs.toString();
      if (s) url += (url.includes('?') ? '&' : '?') + s;
    }

    const headers = { 'Accept': 'application/json' };
    if (state.token) {
      headers['token'] = state.token;
      headers['token-id'] = state.tokenId || '';
    }
    let payload;
    if (method !== 'GET' && body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const res = await fetch(url, { method, headers, body: payload });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { success: false, message: text.slice(0, 200) }; }

    // bluebee 用 status 字段，success 可能不存在
    if (data && data.status !== undefined && data.success === undefined) {
      data.success = String(data.status).indexOf('10_000_') === 0;
    }

    // 401 / token 过期 → 自动重新登录再试一次
    const isExpired = res.status === 401 ||
      (data && (data.status === 401 ||
                String(data.message || '').indexOf('token') >= 0 &&
                String(data.message || '').indexOf('过期') >= 0));

    if (isExpired && state.email && state.password && !opts._retried) {
      await relogin();
      return req(path, Object.assign({}, opts, { _retried: true }));
    }

    return data;
  }

  /**
   * 把用户输入的地址规范成 {scheme}://{host}/api
   * 支持输入：scan.bluebeecloud.com / https://scan.bluebeecloud.com/api 等
   */
  function normalizeBase(input) {
    let u = String(input || '').trim();
    if (!u) return KNOWN_BASE;

    // 官方域名 → 走本地代理，避免 CORS
    if (/platform\.bluebeecloud\.com/i.test(u) &&
        typeof location !== 'undefined' && /^https?:/.test(location.protocol)) {
      return location.origin + '/api';
    }
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    u = u.replace(/\/+$/, '');
    if (!/\/api$/i.test(u)) u = u.replace(/\/bbservices\/.*$/, '') + '/api';
    return u;
  }

  /* ---------- RSA 公钥加密 ---------- */

  /**
   * RSA 加密（Web Crypto，PKCS#1 v1.5）
   * bluebee 的登录协议：email 和 password 都要加密
   */
  /* ---------- 纯 JS RSA（PKCS#1 v1.5），不依赖 Web Crypto ---------- */

  /** base64 → Uint8Array */
  function b64ToBytes(b64) {
    const bin = atob(b64.replace(/[^A-Za-z0-9+/=]/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  /** Uint8Array → base64 */
  function bytesToB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  /** 从 PEM(SPKI) 里解析出 n 和 e（大整数用 BigInt） */
  function parsePublicKey(pem) {
    const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
    const der = b64ToBytes(b64);

    // 极简 DER 解析：找 BIT STRING 里的 RSAPublicKey SEQUENCE
    // SPKI: SEQ { SEQ { OID, NULL }, BIT STRING { SEQ { INTEGER n, INTEGER e } } }
    let i = 0;
    function readLen() {
      let l = der[i++];
      if (l & 0x80) {
        const n = l & 0x7f;
        l = 0;
        for (let k = 0; k < n; k++) l = (l << 8) | der[i++];
      }
      return l;
    }
    function readInt() {
      if (der[i] !== 0x02) throw new Error('期望 INTEGER');
      i++;
      const len = readLen();
      let v = 0n;
      for (let k = 0; k < len; k++) v = (v << 8n) | BigInt(der[i + k]);
      i += len;
      return v;
    }

    if (der[i] !== 0x30) throw new Error('SPKI 格式错误');
    i++; readLen();                       // 外层 SEQ
    if (der[i] === 0x30) { i++; readLen(); i += 0; }  // 算法 SEQ，跳过内容
    // 跳过算法 OID + NULL
    // 重新可靠解析：直接搜索 BIT STRING (0x03) 后的 SEQ
    let j = 0;
    while (j < der.length && der[j] !== 0x03) j++;
    if (j >= der.length) throw new Error('未找到 BIT STRING');
    i = j + 1;
    const bsLen = readLen();
    i++; // 跳过 unused bits 字节
    if (der[i] !== 0x30) throw new Error('RSAPublicKey 格式错误');
    i++; readLen();
    const n = readInt();
    const e = readInt();
    return { n, e };
  }

  /** PKCS#1 v1.5 填充 + 模幂 */
  function rsaEncryptPkcs1(text, pem) {
    const { n, e } = parsePublicKey(pem);
    const k = Math.ceil(n.toString(16).length / 2);   // 模长（字节）

    const msg = new TextEncoder().encode(text);
    if (msg.length > k - 11) throw new Error('内容过长');

    // 填充：0x00 || 0x02 || PS(随机非零) || 0x00 || M
    const padLen = k - msg.length - 3;
    const ps = new Uint8Array(padLen);
    const rnd = new Uint8Array(padLen);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(rnd);
    } else {
      for (let i = 0; i < padLen; i++) rnd[i] = Math.floor(Math.random() * 256);
    }
    for (let i = 0; i < padLen; i++) {
      ps[i] = rnd[i] === 0 ? 1 : rnd[i];   // 不能是 0
    }

    const em = new Uint8Array(k);
    em[0] = 0x00;
    em[1] = 0x02;
    em.set(ps, 2);
    em[2 + padLen] = 0x00;
    em.set(msg, 3 + padLen);

    // 转 BigInt
    let m = 0n;
    for (let i = 0; i < k; i++) m = (m << 8n) | BigInt(em[i]);

    // c = m^e mod n
    let c = 1n;
    let base = m % n;
    let exp = e;
    while (exp > 0n) {
      if (exp & 1n) c = (c * base) % n;
      base = (base * base) % n;
      exp >>= 1n;
    }

    // BigInt → 字节
    const out = new Uint8Array(k);
    let t = c;
    for (let i = k - 1; i >= 0; i--) {
      out[i] = Number(t & 0xffn);
      t >>= 8n;
    }
    return bytesToB64(out);
  }

  async function rsaEncrypt(text, pemB64) {
    const pem = atob(pemB64.trim());
    return rsaEncryptPkcs1(text, pem);
  }

  /** 取服务器公钥 */
  async function fetchPublicKey() {
    const d = await req('security-info', { _retried: true });
    const pc = (d.data || {}).public_code;
    if (!pc) throw new Error('服务器未返回公钥');
    return pc;
  }

  /* ---------- 1. 登录 ---------- */
  async function login(baseUrl, email, password) {
    state.baseUrl = normalizeBase(baseUrl);

    // 1. 取公钥
    const pub = await fetchPublicKey();

    // 2. 加密（email 和 password 都要加密）
    const emailEnc = await rsaEncrypt(email, pub);
    const passEnc = await rsaEncrypt(password, pub);

    // 3. 登录
    // 先尝试普通登录
    let d = await req('login', {
      method: 'POST',
      body: { email: emailEnc, password: passEnc }
    });

    // 已被占用 → 踢掉旧会话重新登录
    if (d && d.data && d.data.confirm_kick) {
      d = await req('login', {
        method: 'POST',
        body: { email: emailEnc, password: passEnc, kick_same_user: 1 }
      });
    }

    if (!d.success) {
      if (d.data && d.data.conflict) {
        const e = new Error('存在多个用户，需要选择');
        e.code = 'CONFLICT'; e.data = d.data;
        throw e;
      }
      throw new Error(d.message || d.tb || '登录失败');
    }

    const info = d.data || {};
    state.token = info.token || '';
    state.tokenId = info.token_id || '';
    state.userName = info.user_name || email;
    state.email = email;
    state.password = password;
    save();
    return info;
  }

  /** 静默重新登录 */
  let _reloginPromise = null;
  async function relogin() {
    if (_reloginPromise) return _reloginPromise;
    _reloginPromise = (async () => {
      try {
        const pub = await fetchPublicKey();
        const emailEnc = await rsaEncrypt(state.email, pub);
        const passEnc = await rsaEncrypt(state.password, pub);
        const d = await req('login', {
          method: 'POST',
          body: { email: emailEnc, password: passEnc, kick_same_user: 1 },
          _retried: true
        });
        const ok = d && (d.success ||
          (typeof d.status === 'string' && d.status.indexOf('10_000_') === 0));
        if (ok && d.data && d.data.token) {
          state.token = d.data.token;
          state.tokenId = d.data.token_id || '';
          save();
          return true;
        }
      } catch (e) {
        // 忽略，交给上层报错
      } finally {
        _reloginPromise = null;
      }
      return false;
    })();
    return _reloginPromise;
  }

  /* ---------- 2. 菜单：找「预防性维护」 ---------- */
  async function fetchMenu() {
    const d = await req('menu');
    if (!d.success) throw new Error(d.message || '获取菜单失败');
    state.menuRaw = d.data;
    save();

    const found = findPreventive(d.data);
    if (found) {
      state.contentId = found.content_id;
      state.parameterId = found.parameter_id;
      save();
    }
    return { raw: d.data, found };
  }

  /**
   * 在菜单树里找「预防性维护」
   * 结构：menu: [{ seq, title, menuList: [{ content_id, parameter_id, menu_id, ... }] }]
   */
  function findPreventive(menuData) {
    if (!Array.isArray(menuData)) return null;

    const flat = [];
    menuData.forEach(group => {
      const list = group.menuList || group.children || group.list || [];
      if (Array.isArray(list)) {
        list.forEach(item => flat.push(item));
      }
    });

    // 精确匹配
    let hit = flat.find(it => {
      const t = it.title || it.name || it.label || '';
      return t.indexOf('预防性维护') >= 0;
    });
    // 模糊匹配
    if (!hit) {
      hit = flat.find(it => {
        const t = it.title || it.name || it.label || '';
        return t.indexOf('预防') >= 0 && t.indexOf('维护') >= 0;
      });
    }
    if (!hit) return null;

    return {
      content_id: hit.content_id,
      parameter_id: hit.parameter_id || 0,
      menu_id: hit.menu_id,
      parent_menu_id: hit.parent_menu_id,
      title: hit.title,
      all: flat,
      raw: hit
    };
  }

  /* ---------- 3. 筛选标签 ---------- */
  async function fetchFilters() {
    const d = await req('content/filter/list', {
      params: { parameter_id: state.parameterId, content_id: state.contentId }
    });
    if (!d.success) throw new Error(d.message || '获取筛选失败');
    const list = (d.data && d.data.data) || [];
    return { list, isReverse: d.data && d.data.is_reverse };
  }

  /* ---------- 4. 工单列表 ---------- */
  async function fetchList(opts = {}) {
    const {
      filterId = 0, page = 0, pageSize = 10,
      fields = '', ops = '', values = '',
      contentId = state.contentId, parameterId = state.parameterId
    } = opts;

    const params = {
      content_id: contentId || CFG.CONTENT_WO,
      parameter_id: parameterId || CFG.PARAM_PM,
      pagenum: page,
      pagesize: pageSize,
      batch_ids_num: 0,
      batch_check_task_id: '',
      sortorder: '',
      sortdatafield: '',
      filter_id: filterId
    };
    if (fields) { params.fields = fields; params.ops = ops; params.values = values; }

    const d = await req('content/list/filter/data-list', { params });

    // bluebee 用 status 判断
    const ok = d && (d.success === true ||
                     (typeof d.status === 'string' && d.status.indexOf('10_000_') === 0));
    if (!ok) throw new Error((d && (d.message || d.tb)) || '获取工单失败');

    return d.data || { totalrecords: 0, list: [] };
  }

  /* ---------- 4.5 字段定义 ---------- */

  /**
   * 获取工单表单字段定义（91 个）
   * 返回 [{ field_id, label, type, ... }]
   */
  async function fetchFormFields(contentId) {
    const d = await req('content/display-field/list', {
      params: { content_id: contentId || CFG.CONTENT_WO }
    });
    const ok = d && (d.success || (typeof d.status === 'string' && d.status.indexOf('10_000_') === 0));
    if (!ok) throw new Error((d && (d.message || d.tb)) || '获取字段失败');
    const groups = (d.data && d.data.data) || [];
    const out = [];
    groups.forEach(g => {
      (g.displayField || []).forEach(f => {
        out.push({
          field_id: f.field_id,
          label: f.label || f.field_label || '',
          type: f.type || 'text',
          display: f.display !== false,
          extra: f.extra || {}
        });
      });
    });
    return out;
  }

  async function fetchFields() {
    const d = await req('content/display-field/list', {
      params: { content_id: state.contentId }
    });
    if (!d.success) return [];
    const list = d.data || [];
    return Array.isArray(list) ? list : (list.data || []);
  }

  /**
   * 从字段列表里找「安排时间」的 field_id
   * 字段结构：{ field_id, field_name, label, title, type }
   */
  function findPlanFieldId(fields) {
    if (!Array.isArray(fields)) return '';
    const keys = ['安排时间', '计划时间', '排班时间'];
    for (const kw of keys) {
      const hit = fields.find(f => {
        const lb = f.label || f.field_label || f.title || f.name || f.field_name || '';
        return String(lb).indexOf(kw) >= 0;
      });
      if (hit) return hit.field_id || hit.id || hit.field_name || '';
    }
    return '';
  }

  /* ---------- 5. 多列筛选项 ---------- */
  async function fetchMultiFilter() {
    const d = await req('content/multi-filter/headline-options', {
      params: { content_id: state.contentId, parameter_id: state.parameterId }
    });
    return d.success ? d.data : null;
  }

  /* ---------- 6. 工单详情 ---------- */

  /**
   * 拉取工单详情
   * 返回 { success, data: [...] }
   * 数组元素：{ field_id, field_lable, value }
   */
  async function fetchDetail(dataId, contentId, parameterId) {
    const d = await req('content/detail/headline-data', {
      params: {
        content_id: contentId || CFG.CONTENT_WO,
        data_id: dataId,
        fields: '',
        values: ''
      }
    });
    const ok = d && (d.success || (typeof d.status === 'string' && d.status.indexOf('10_000_') === 0));
    if (!ok) throw new Error((d && (d.message || d.tb)) || '获取详情失败');
    return d.data || [];
  }

  /**
   * 保存工单
   * @param {number} dataId
   * @param {Array} changes  形如 [{field_id, value, isUpdate:true}]
   * @param {object} meta    { workflow_field_id, workflow_data_id, ... }
   */
  async function saveDetail(dataId, changes, meta) {
    meta = meta || {};
    const payload = {
      content_id: CFG.CONTENT_WO,
      data_id: dataId,
      parameter_field_id: meta.parameter_field_id || 0,
      parameter_data_id: meta.parameter_data_id || 0,
      workflow_field_id: meta.workflow_field_id || CFG.FIELD_STATUS,
      workflow_data_id: meta.workflow_data_id || null,
      entity_field_id: meta.entity_field_id || 0,
      entity_data_id: meta.entity_data_id || 0,
      values: changes.map(c => ({
        field_id: c.field_id,
        value: c.value === undefined ? null : c.value,
        isUpdate: true
      }))
    };

    const d = await req('content/detail/headline-data', {
      method: 'POST',
      body: payload
    });

    const ok = d && (d.success || (typeof d.status === 'string' && d.status.indexOf('10_000_') === 0));
    if (!ok) throw new Error((d && (d.message || d.tb)) || '保存失败');
    return d;
  }

  /**
   * 拉取子表（工作措施等）
   * 找不到就返回空数组，不影响主流程
   */
  /** 工作措施子表 content_id */
  const GRID_MEASURE = 157;

  /** 措施状态取值 */
  const MEASURE_STATE = { normal: 143, standby: 144, error: 145, pending: 146 };
  const MEASURE_STATE_NAME = { 143: '正常', 144: '备机', 145: '异常', 146: '未处理' };

  /**
   * 拉取工单的工作措施
   * 返回 [{ id, code, desc, state, stateName, raw }]
   */
  async function fetchMeasures(dataId, paramDataId) {
    const d = await req('content/detail/datagrid-data-list', {
      params: {
        content_id: CFG.CONTENT_WO,
        content_data_id: dataId,
        relational_content_id: GRID_MEASURE,
        relational_data_id: dataId,
        parameter_field_id: CFG.PARAM_FIELD,
        parameter_data_id: paramDataId || 0,
        workflow_field_id: CFG.FIELD_STATUS,
        workflow_data_id: 70,
        entity_field_id: 0,
        entity_data_id: 0,
        pagenum: 0,
        pagesize: 200
      }
    });
    const ok = d && (d.success || (typeof d.status === 'string' && d.status.indexOf('10_000_') === 0));
    if (!ok) throw new Error((d && (d.message || d.tb)) || '工作措施加载失败');

    const rows = Array.isArray(d.data) ? d.data : ((d.data && d.data.data) || []);
    return rows.map(r => {
      const codeObj = r['327'] || {};
      const descObj = r['328'] || {};
      const st = r['940'];
      // 940 可能是数字 id、"正常" 字符串，或 {id,name}
      let stateId = 0, stateName = '';
      if (typeof st === 'number') { stateId = st; stateName = MEASURE_STATE_NAME[st] || ''; }
      else if (typeof st === 'string' && st) {
        const found = Object.keys(MEASURE_STATE_NAME).find(k => MEASURE_STATE_NAME[k] === st);
        stateId = found ? Number(found) : 0;
        stateName = st;
      } else if (st && typeof st === 'object') {
        stateId = st.id || 0;
        stateName = st.name || MEASURE_STATE_NAME[stateId] || '';
      }
      return {
        id: r.id,
        code: codeObj.name || '',
        desc: descObj.name || '',
        state: stateId,
        stateName: stateName,
        raw: r
      };
    });
  }

  /**
   * 保存单条措施的状态
   * @param {number} dataId    工单 id
   * @param {number} rowId     措施行 id
   * @param {number} stateId   143 正常 / 144 备机 / 145 异常 / 146 未处理
   * @param {number} paramDataId
   */
  async function saveMeasureState(dataId, rowId, stateId, paramDataId) {
    const d = await req('content/detail/datagrid-data', {
      method: 'POST',
      body: {
        content_id: CFG.CONTENT_WO,
        content_data_id: dataId,
        relational_content_id: GRID_MEASURE,
        relational_data_id: rowId,          // ★ 必须是措施行的 id，不是工单 id
        parameter_field_id: CFG.PARAM_FIELD,
        parameter_data_id: paramDataId || 0,
        workflow_field_id: CFG.FIELD_STATUS,
        workflow_data_id: 70,
        entity_field_id: 0,
        entity_data_id: 0,
        values: [{
          type: 'radioBox',
          field_id: 940,
          value: [stateId],
          field_value: [stateId],
          isUpdate: true,
          is_delegate: false,
          delegate_id: -1
        }]
      }
    });
    const ok = d && (d.success || (typeof d.status === 'string' && d.status.indexOf('10_000_') === 0));
    if (!ok) throw new Error((d && (d.message || d.tb)) || '保存失败');
    return d;
  }

  /* ---------- 7. 扫码校验 ---------- */
  async function scanCode({ contentId, gridId, fkdContentId, code }) {
    const d = await req('content/scan-code', {
      params: {
        type: 'detail',
        content_id: contentId,
        data_grid_id: gridId,
        fkd_content_id: fkdContentId,
        code
      }
    });
    return d;
  }

  /* ---------- 班次时间 ---------- */
  function pad(n) { return ('0' + n).slice(-2); }
  function fmt(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  /**
   * 班次时间区间
   * 实测数据：
   *   白班 08:00-20:00
   *   夜班 20:00-次日08:00（跨日，需分两段查）
   */
  /**
   * 班次时间区间（严格按需求）
   *   白班：当天 08:00:00 ~ 当天 20:00:00
   *   夜班：当天 20:00:00 ~ 次日 08:00:00
   */
  /**
   * 班次时间范围
   *   白班：当天 08:00:00 ~ 20:00:00
   *   夜班：20:00 ~ 次日 08:00
   *
   * 夜班归属规则：
   *   若当前时刻已过零点但未到 08:00（即凌晨 00:00~07:59:59），
   *   说明这个夜班是「前一天」开始的 →
   *     起 = 前一天 20:00
   *     止 = 当天 08:00
   *   其余时刻（08:00 之后）→
   *     起 = 当天 20:00
   *     止 = 次日 08:00
   */
  /**
   * 班次时间范围
   *
   *   白班  = 当天 08:00 ~ 20:00
   *   夜班1 = 当天 20:00 ~ 次日 08:00
   *           （凌晨 00:00~07:59 点「夜班1」，取「当天」20:00 ~ 次日 08:00）
   *   夜班2 = 夜班1 的日期往前减一天
   *
   * 举例（今天是 25 号）：
   *   夜班1 → 25号 20:00 ~ 26号 08:00
   *   夜班2 → 24号 20:00 ~ 25号 08:00
   */
  function buildShift(shift, now = new Date()) {
    const pad = n => ('0' + n).slice(-2);
    const fmtDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const DAY = 86400000;

    if (shift === 'day') {
      return {
        start: fmtDate(now) + ' 08:00:00',
        end:   fmtDate(now) + ' 20:00:00'
      };
    }

    // 夜班基准日期：就是「今天」
    const base = new Date(now.getTime());

    // 夜班2：基准日往前推一天
    if (shift === 'night2') {
      base.setTime(base.getTime() - DAY);
    }

    const next = new Date(base.getTime() + DAY);
    return {
      start: fmtDate(base) + ' 20:00:00',
      end:   fmtDate(next) + ' 08:00:00'
    };
  }


  return {
    CFG, HEADLINE_FIELDS, WORKFLOW, USERS, fetchUsers, fetchWorkflowOptions, state, save, load, clear, req, normalizeBase, rsaEncrypt, fetchPublicKey,
    KNOWN_BASE,
    login, fetchMenu, fetchFilters, fetchList, fetchMultiFilter, fetchDetail, scanCode,
    fetchFields, findPlanFieldId, saveDetail, fetchMeasures, saveMeasureState,
    MEASURE_STATE, MEASURE_STATE_NAME, GRID_MEASURE, fetchFormFields,
    buildShift,
    findPreventive
  };
})();

window.API = API;
