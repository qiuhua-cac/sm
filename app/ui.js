/**
 * ui.js —— 精简版交互逻辑
 * 只包含：登录 / 筛选标签 / 工单列表 / 白班夜班 / 详情 / 扫码
 */

(() => {
  const $ = (id) => document.getElementById(id);

  const S = {
    filters: [],
    currentFilterId: 0,
    page: 0,
    pageSize: 10,
    list: [],
    total: 0,
    loading: false,
    shiftFilter: { fields: '', ops: '', values: '' },
    detail: null,
    detailId: null,
    fieldIds: { plan: '' },
    formFields: [],
    paramDataId: 0
  };

  /* ==================== 通用 ==================== */

  function toast(msg, ms = 1800) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), ms);
  }

  function loading(on) {
    $('loading').classList.toggle('hide', !on);
  }

  function showView(name) {
    const main = $('main');
    $('login-view').classList.toggle('hide', name !== 'login');
    $('topbar').classList.toggle('hide', name === 'login');
    main.classList.toggle('hide', name === 'login');
    $('actionbar').classList.toggle('hide', name !== 'list');
    $('btn-back').classList.toggle('hide', name !== 'detail');
    $('btn-logout').classList.toggle('hide', name !== 'list');
    $('top-title').textContent =
      name === 'detail' ? '工单详情' : '预防性维护';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ==================== 地址记忆 ==================== */

  // 固定服务器地址（永久写死，不再让用户填）
  // 服务器地址：始终用同域 /api
  //   本地 → proxy.py 转发
  //   线上 → Pages Function 转发（functions/api/[[path]].js）
  const FIXED_BASE = location.origin + '/api';
  const ADDR_KEY = 'bbmini_addrs';
  const REMEMBER_KEY = 'bbmini_remember';
  const CRED_KEY = 'bbmini_cred';

  function getAddrs() {
    try { return JSON.parse(localStorage.getItem(ADDR_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function saveAddr(addr) {
    if (!addr) return;
    let list = getAddrs().filter(x => x !== addr);
    list.unshift(addr);
    list = list.slice(0, 5);
    try { localStorage.setItem(ADDR_KEY, JSON.stringify(list)); } catch (e) {}
  }

  /** 地址历史已隐藏，不再渲染 */
  function renderAddrHistory() {
    const box = $('base-history');
    if (box) box.classList.add('hide');
  }

  /** 读取记住的账号密码 */
  function loadCred() {
    try {
      const raw = localStorage.getItem(CRED_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function saveCred(user, pass, remember) {
    try {
      if (remember) {
        localStorage.setItem(REMEMBER_KEY, '1');
        localStorage.setItem(CRED_KEY, JSON.stringify({ u: user, p: pass }));
      } else {
        localStorage.removeItem(REMEMBER_KEY);
        localStorage.removeItem(CRED_KEY);
      }
    } catch (e) {}
  }

  function clearCred() {
    try {
      localStorage.removeItem(REMEMBER_KEY);
      localStorage.removeItem(CRED_KEY);
    } catch (e) {}
  }

  /* ==================== 登录 ==================== */

  async function doLogin() {
    const base = FIXED_BASE;
    const user = $('inp-user').value.trim();
    const pass = $('inp-pass').value;
    const remember = $('chk-remember') ? $('chk-remember').checked : false;

    if (!user || !pass) {
      return toast('请填写账号和密码');
    }

    $('btn-login').disabled = true;
    $('login-msg').textContent = '';
    loading(true);

    try {
      await API.login(base, user, pass);
      saveAddr(base);
      saveCred(user, pass, remember);
      toast('登录成功');
      await bootAfterLogin();
    } catch (e) {
      $('login-msg').textContent = e.message || '登录失败';
      toast(e.message || '登录失败');
    } finally {
      $('btn-login').disabled = false;
      loading(false);
    }
  }

  async function bootAfterLogin() {
    loading(true);
    try {
      // 默认白班
      const r0 = API.buildShift('day');
      S.shiftFilter = {
        fields: String(API.CFG.FIELD_PLAN_TIME),
        ops: 'r',
        values: r0.start + '|' + r0.end
      };
      // 直接用已知的 content_id / parameter_id
      API.state.contentId = API.CFG.CONTENT_WO;
      API.state.parameterId = API.CFG.PARAM_PM;
      API.save();

      await loadFilters();
      showView('list');
      await loadList(true);
    } catch (e) {
      $('login-msg').textContent = e.message || '加载失败';
      toast(e.message || '加载失败');
    } finally {
      loading(false);
    }
  }

  /* ==================== 字段发现 ==================== */

  async function loadFieldIds() {
    try {
      const fields = await API.fetchFields();
      const planId = API.findPlanFieldId(fields);
      S.fieldIds.plan = planId;
      console.log('[字段] 安排时间 field_id =', planId || '(未找到)', '共', fields.length, '个字段');
      if (!planId) {
        console.warn('[字段] 字段清单:', fields.map(f => (f.label || f.title || f.field_name)));
      }
    } catch (e) {
      console.warn('获取字段定义失败:', e.message);
    }
  }

  /* ==================== 筛选标签 ==================== */

  async function loadFilters() {
    // 直接用已知的标签（从服务器验证过）
    S.filters = [
      { id: API.CFG.FILTER_IN_PROGRESS, name: '进行中' },
      { id: API.CFG.FILTER_OVERDUE,     name: '过期未完成' },
      { id: 46,                          name: '已完成' }
    ];
    S.currentFilterId = API.CFG.FILTER_IN_PROGRESS;
    renderTabs();
  }

  function renderTabs() {
    let tabs = $('tabs');
    if (!tabs) {
      tabs = document.createElement('div');
      tabs.id = 'tabs';
      $('main').parentNode.insertBefore(tabs, $('main'));
    }
    tabs.innerHTML = S.filters.map(f =>
      `<div class="tab ${S.currentFilterId === f.id ? 'active' : ''}"
            data-id="${f.id}">${esc(f.name)}</div>`
    ).join('');
    tabs.classList.remove('hide');

    tabs.querySelectorAll('.tab').forEach(el => {
      el.onclick = async () => {
        S.currentFilterId = Number(el.dataset.id);
        tabs.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
        await loadList(true);
      };
    });
  }

  /* ==================== 工单列表 ==================== */

  async function loadList(reset) {
    if (S.loading) return;
    S.loading = true;

    if (reset) { S.page = 0; S.list = []; }

    loading(true);
    try {
      const d = await API.fetchList({
        filterId: S.currentFilterId,
        page: S.page,
        pageSize: S.pageSize,
        fields: S.shiftFilter.fields,
        ops: S.shiftFilter.ops,
        values: S.shiftFilter.values
      });

      const items = d.list || [];
      S.total = d.totalrecords || 0;
      S.list = reset ? items : S.list.concat(items);
      S.page += 1;
      renderList();
    } catch (e) {
      toast(e.message || '加载失败');
    } finally {
      loading(false);
      S.loading = false;
    }
  }

  function renderList() {
    const main = $('main');

    if (!S.list.length) {
      main.innerHTML = `<div class="empty">
        <div class="ic">📋</div>
        <div>没有工单</div>
      </div>`;
      $('btn-more').classList.add('hide');
      return;
    }

    let html = '';
    const F = API.CFG;
    S.list.forEach((it, i) => {
      const code  = it['content108$field' + F.FIELD_CODE] || '';
      const desc  = it['content108$field' + F.FIELD_DESC] || '(无描述)';
      const plan  = it['content108$field' + F.FIELD_PLAN_TIME] || '';
      const wStart = it['content108$field694'] || '';
      const wEnd   = it['content108$field695'] || '';
      const st    = it['content108$field' + F.FIELD_STATUS];
      const stName = (st && st.name) ? st.name : '';

      // 班次标签
      let shiftTag = '';
      if (desc.indexOf('白班') >= 0) shiftTag = '白班';
      else if (desc.indexOf('夜班') >= 0) shiftTag = '夜班';

      html += `<div class="ticket" data-idx="${i}">
        <div class="code">${esc(code)}</div>
        <div class="title">${esc(desc)}</div>
        <div class="meta">
          ${shiftTag ? `<span class="badge">${shiftTag}</span>` : ''}
          <span class="badge badge-time">${esc(shiftRange(desc))}</span>
          ${stName ? `<span class="muted">${esc(stName)}</span>` : ''}
        </div>
      </div>`;
    });

    main.innerHTML = html;

    main.querySelectorAll('.ticket').forEach(el => {
      el.onclick = () => openDetail(S.list[Number(el.dataset.idx)]);
    });

    // 加载更多
    $('btn-more').classList.toggle('hide', S.list.length >= S.total);
  }

  /* ==================== 详情 ==================== */

  async function openDetail(item) {
    if (!item) return;
    const dataId = item.id || item.data_id;
    S.detailId = dataId;

    loading(true);
    try {
      // 并行拉：详情值 + 字段定义
      const [values, defs] = await Promise.all([
        API.fetchDetail(dataId),
        S.formFields.length ? Promise.resolve(S.formFields) : API.fetchFormFields()
      ]);
      S.formFields = defs;
      S.detail = values;
      S.detailChanged = {};

      // 记录 parameter_data_id（= 工单类型主项的 id，状态切换必需）
      const pt = values.find(v => v.field_id === 702);
      const pid = pt && pt.value && pt.value.id ? pt.value.id : 0;
      S.paramDataId = pid || 2;

      showView('detail');
      renderDetail(values, defs);
    } catch (e) {
      toast(e.message || '加载详情失败');
    } finally {
      loading(false);
    }
  }

  /** 时间字符串 → HH:mm */
  function hm(v) {
    if (!v) return '';
    const str = String(v).replace('T', ' ');
    const m = str.match(/\s(\d{2}):(\d{2})/);
    if (m) return m[1] + ':' + m[2];
    const m2 = str.match(/^(\d{2}):(\d{2})/);
    if (m2) return m2[1] + ':' + m2[2];
    return str;
  }

  /** 时间 → 整点 HH:00（用于列表显示） */
  function hourOnly(v) {
    if (!v) return '';
    const str = String(v).replace('T', ' ');
    const m = str.match(/(\d{2}):(\d{2})/);
    return m ? m[1] + ':00' : '';
  }

  /**
   * 列表卡片显示的时间段（固定 2 小时）
   *   白班 → 07:00-08:30
   *   夜班 → 19:00-20:30
   */
  function shiftRange(desc) {
    const d = String(desc || '');
    if (d.indexOf('夜班') >= 0) return '19:00-20:30';
    if (d.indexOf('白班') >= 0) return '07:00-08:30';
    return '';
  }

  /** 值 → 显示文本 */
  function displayValue(v) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'object') {
      if (Array.isArray(v)) return v.length ? v.length + ' 项' : '';
      if (v.name !== undefined && v.name !== null) return v.name;
      if (v.dateTime) return v.dateTime;
      return '';
    }
    if (typeof v === 'number') return String(v);
    return String(v);
  }

  /** 可编辑的字段类型 */
  const EDITABLE = {
    dateTime: 1, text: 1, textarea: 1, decimal: 1, number: 1
  };

  /**
   * 详情页布局（按需求）
   * 顶部：工单代码 + [保存]
   * 工单状态
   * 负责人
   * 工单开始时间 / 工单结束时间（一个「一键填充」按钮）
   * 其余字段全部只读
   */
  function renderDetail(values, defs) {
    const main = $('main');

    const valMap = {};
    (values || []).forEach(v => { valMap[v.field_id] = v.value; });

    const FIELDS = API.HEADLINE_FIELDS;
    const byId = {};
    FIELDS.forEach(f => { byId[f.field_id] = f; });

    function val(fid) {
      return displayValue(valMap[fid]);
    }

    function plainRow(fid, extra) {
      const f = byId[fid] || { label: '', type: 'text' };
      const v = val(fid);
      return `<div class="frow readonly" data-row="${fid}">
        <div class="flabel">${esc(f.label)}</div>
        <div class="fval ${!v ? 'empty' : ''}" data-val="${fid}">${esc(v) || '—'}</div>
        ${extra || '<span class="flock">🔒</span>'}
      </div>`;
    }

    let html = '';

    // ---------- 顶部：工单代码 + 保存 ----------
    html += `<div class="detail-head">
      <div class="dh-code">
        <div class="dh-label">工单代码</div>
        <div class="dh-value" data-val="689">${esc(val(689)) || '—'}</div>
      </div>
      <button class="btn dh-save" id="btn-save-detail">保 存</button>
    </div>`;

    // ---------- 可编辑区 ----------
    html += '<div class="section">';

    // 工单状态（可切换，选项从服务器拉）
    html += `<div class="frow" data-row="704">
      <div class="flabel">工单状态</div>
      <div class="fval" data-val="704">${esc(val(704)) || '—'}</div>
      <span class="fedit" data-wf="704">切换</span>
    </div>`;

    // 责任人
    html += `<div class="frow compact-row" data-row="2531">
      <div class="flabel">责任人</div>
      <div class="fval ${val(2531) ? '' : 'empty'}" data-val="2531">${esc(val(2531)) || '—'}</div>
      <span class="fedit" data-user="2531">选择</span>
    </div>`;

    // 工单开始时间
    html += `<div class="frow time-row" data-row="694">
      <div class="flabel">工单开始时间</div>
      <div class="fval" data-val="694">${esc(val(694)) || '—'}</div>
      <span class="flock">🔒</span>
    </div>`;

    // 工单结束时间
    html += `<div class="frow time-row" data-row="695">
      <div class="flabel">工单结束时间</div>
      <div class="fval" data-val="695">${esc(val(695)) || '—'}</div>
      <span class="flock">🔒</span>
    </div>`;

    // 一键填充（一个按钮）
    html += `<div class="fillbar">
      <button class="btn fill-btn" id="btn-fill-worktime">一键填充开始/结束时间</button>
      <div class="muted" id="wt-hint">按安排时间：开始 +1~5 分钟，结束 +40~60 分钟</div>
    </div>`;

    html += '</div>';

    // ---------- 其余字段只读 ----------
    html += '<div class="section">';
    html += '<div class="section-title">工单信息</div>';

    const SHOW = [690, 700, 701, 702, 2530, 703, 697, 2093,
                  692, 693, 2485, 1558, 705, 1821, 2518,
                  1559, 1560, 699, 698, 688, 2190];
    SHOW.forEach(fid => { html += plainRow(fid); });

    html += '</div>';

    // ---------- 工作措施 ----------
    html += `<div class="section">
      <div class="section-title">工作措施</div>
      <div id="measure-list"><div class="muted" style="padding:16px;text-align:center">—</div></div>
    </div>`;

    main.innerHTML = html;

    // 事件
    main.querySelectorAll('[data-wf]').forEach(b => {
      b.onclick = () => pickWorkflow(Number(b.dataset.wf), b.closest('.frow'));
    });
    main.querySelectorAll('[data-user]').forEach(b => {
      b.onclick = () => pickUser(Number(b.dataset.user), b.closest('.frow'));
    });
    $('btn-fill-worktime').onclick = fillWorkTime;
    $('btn-save-detail').onclick = doSaveDetail;

    loadMeasures(S.detailId);
  }

  /* ============ 一键填充 工单开始/结束时间 ============ */

  /**
   * 规则：
   *   以「安排时间」为基准
   *   开始 = 安排时间 + 1~5 分钟（随机）
   *   结束 = 安排时间 + 40~60 分钟（随机）
   */
  /**
   * 一键填充工单开始/结束时间
   *
   * 严格以「安排时间」为基准：
   *   安排 13:00  →  开始 13:0X:XX，结束 13:XX:XX
   *   日期、小时都跟安排时间完全一致，只有分钟秒数随机
   *   开始：+1~5 分钟
   *   结束：+40~60 分钟
   *   若结束超过 23:59:59，则从安排时间往前回退（保持同样的相对偏移）
   */
  function fillWorkTime() {
    const plan = S.detail.find(f => f.field_id === 692);
    if (!plan || !plan.value) return toast('请先设置「安排时间」');

    const baseStr = String(plan.value).replace('T', ' ');
    const base = new Date(baseStr.replace(/-/g, '/'));
    if (isNaN(base.getTime())) return toast('安排时间格式异常：' + baseStr);

    const pad = n => ('0' + n).slice(-2);
    const fmt = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
                     ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());

    // 安排时间的小时/分钟（作为基准，不跨小时）
    const baseH = base.getHours();
    const baseM = base.getMinutes();

    // 开始：安排分钟 + 1~5（若超过 59，保持在同一小时内会溢出，就直接用原分钟）
    const startAdd = 1 + Math.floor(Math.random() * 5);        // 1..5
    let sm = baseM + startAdd;
    let sh = baseH;
    if (sm > 59) { sm = 59; }                                   // 不跨到下一小时
    const ss = Math.floor(Math.random() * 60);

    // 结束：安排分钟 + 40~60
    // 小时与安排时间保持同一小时（若加完超过 59 分，则限制在 59 分）
    const endAdd = 40 + Math.floor(Math.random() * 21);        // 40..60
    let em = baseM + endAdd;
    let eh = baseH;
    if (em > 59) { em = 59; }                                   // 锁在同一小时
    const es = Math.floor(Math.random() * 60);

    const st = new Date(base.getTime());
    st.setHours(sh, sm, ss, 0);

    const et = new Date(base.getTime());
    et.setHours(eh, em, es, 0);

    // 组装字符串（日期一律用安排时间的日期）
    const dstr = base.getFullYear() + '-' + pad(base.getMonth() + 1) + '-' + pad(base.getDate());
    const stStr = dstr + ' ' + pad(sh) + ':' + pad(sm) + ':' + pad(ss);
    const etStr = dstr + ' ' + pad(eh) + ':' + pad(em) + ':' + pad(es);

    setFieldValue(694, stStr);
    setFieldValue(695, etStr);

    const durMin = Math.round((et - st) / 60000);
    $('wt-hint').textContent =
      '按安排时间 ' + pad(baseH) + ':' + pad(baseM) +
      ' → 开始 ' + pad(sh) + ':' + pad(sm) + ':' + pad(ss) +
      '（+' + startAdd + '分） 结束 ' + pad(eh) + ':' + pad(em) + ':' + pad(es) +
      '（+' + endAdd + '分，时长 ' + durMin + '分钟）';

    toast('已填充工作时间');
  }

  /* ============ 工单状态选择 ============ */

  /**
   * 状态选择：只改界面，不提交
   * 必须点「保存」才真正写服务器
   */
  async function pickWorkflow(fieldId, rowEl) {
    loading(true);
    let opts = [];
    try {
      opts = await API.fetchWorkflowOptions(S.detailId);
    } catch (e) {} finally { loading(false); }

    const cur = S.detail.find(f => f.field_id === fieldId);
    const curId = cur && cur.value ? cur.value.id : null;

    // 服务器只给了当前状态 → 用内置完整列表兜底
    if (!opts.length || (opts.length === 1 && opts[0].id === curId)) {
      opts = API.WORKFLOW.map(w => ({
        id: w.id, name: w.name, color: w.color, canNote: true
      }));
    }

    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `<div class="modal-box">
      <div class="modal-title">工单状态</div>
      <div class="opt-list">
        ${opts.map(w => `
          <div class="opt-item ${w.id === curId ? 'sel' : ''}" data-id="${w.id}">
            <span class="dot" style="background:${w.color}"></span>
            <span class="nm">${esc(w.name)}</span>
          </div>`).join('')}
      </div>
      <div class="muted" style="margin-top:10px;font-size:11.5px;text-align:center">
        选好记得点顶部「保存」才会提交
      </div>
      <button class="btn gray" data-cancel style="margin-top:10px">取消</button>
    </div>`;
    document.body.appendChild(mask);

    mask.querySelectorAll('.opt-item').forEach(el => {
      el.onclick = () => {
        const id = Number(el.dataset.id);
        const w = opts.find(x => x.id === id);
        const v = { id: id, name: w.name, color: w.color, note: '' };

        // 只记在本地，等点保存才提交
        S.detailChanged[fieldId] = v;
        if (cur) cur.value = v;

        const box = rowEl.querySelector('[data-val]');
        box.textContent = w.name;
        box.classList.remove('empty');
        rowEl.classList.add('dirty');

        toast('已选「' + w.name + '」，点保存提交');
        mask.remove();
      };
    });
    mask.querySelector('[data-cancel]').onclick = () => mask.remove();
    mask.onclick = e => { if (e.target === mask) mask.remove(); };
  }

  /* ============ 负责人选择 ============ */

  async function pickUser(fieldId, rowEl) {
    loading(true);
    let users = [];
    try {
      users = await API.fetchUsers(S.detailId);
    } catch (e) {
      // ignore
    } finally {
      loading(false);
    }
    if (!users.length) return toast('没有可选人员');

    const cur = S.detail.find(f => f.field_id === fieldId);
    const curId = cur && cur.value ? String(cur.value.id) : '';

    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `<div class="modal-box">
      <div class="modal-title">责任人</div>
      <input id="user-search" class="finput" placeholder="搜索姓名…" style="margin-bottom:10px">
      <div class="opt-list" id="user-list">
        ${users.map(u => `
          <div class="opt-item ${String(u.id) === curId ? 'sel' : ''}" data-id="${u.id}" data-name="${esc(u.name)}">
            ${esc(u.name)}
          </div>`).join('')}
      </div>
      <button class="btn gray" data-cancel style="margin-top:12px">取消</button>
    </div>`;
    document.body.appendChild(mask);

    // 搜索过滤
    const inp = mask.querySelector('#user-search');
    inp.oninput = () => {
      const k = inp.value.trim().toLowerCase();
      mask.querySelectorAll('.opt-item').forEach(el => {
        const nm = el.dataset.name.toLowerCase();
        el.style.display = (!k || nm.indexOf(k) >= 0) ? '' : 'none';
      });
    };

    mask.querySelectorAll('.opt-item').forEach(el => {
      el.onclick = () => {
        const uid = Number(el.dataset.id);
        const uname = el.dataset.name;
        // 责任人字段(2531)存数字 id
        S.detailChanged[fieldId] = uid;
        if (cur) cur.value = { id: uid, name: uname };
        const box = rowEl.querySelector('[data-val]');
        box.textContent = uname;
        box.classList.remove('empty');
        toast('责任人 → ' + uname);
        mask.remove();
      };
    });
    mask.querySelector('[data-cancel]').onclick = () => mask.remove();
    mask.onclick = e => { if (e.target === mask) mask.remove(); };
  }

  /* ============ 值显示与设置 ============ */

  function displayValue(v) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'object') {
      if (Array.isArray(v)) return v.length ? v.length + ' 项' : '';
      if (v.name !== undefined && v.name !== null) return v.name;
      if (v.dateTime) return v.dateTime;
      return '';
    }
    return String(v);
  }

  /** 设置单个字段值 */
  function setFieldValue(fieldId, val) {
    S.detailChanged[fieldId] = val;
    const f = S.detail.find(x => x.field_id === fieldId);
    if (f) f.value = val;

    const v = document.querySelector('[data-val="' + fieldId + '"]');
    if (!v) return;

    const txt = displayValue(val);
    v.textContent = txt || '—';
    v.classList.toggle('empty', !txt);
  }

  /* ============ 保存 ============ */

  async function doSaveDetail() {
    const keys = Object.keys(S.detailChanged);
    if (!keys.length) return toast('没有修改');

    // 状态字段单独处理
    const hasStatus = keys.indexOf('704') >= 0;
    const wfTarget = S.detailChanged[704];
    const wf = S.detail.find(f => f.field_id === 704);
    const curWfId = wf && wf.value && wf.value.id ? wf.value.id : 70;

    // 组装 values（去掉 704，合并到状态提交里）
    const normalChanges = keys
      .filter(k => k !== '704')
      .map(fid => ({
        field_id: Number(fid),
        value: S.detailChanged[fid],
        isUpdate: true
      }));

    // 参数：parameter_field_id=517, parameter_data_id=工单的工作类型id
    const PARAM = {
      parameter_field_id: API.CFG.PARAM_FIELD,
      parameter_data_id: S.paramDataId || 3
    };

    loading(true);
    let normalOk = true, statusOk = true, errMsg = '';

    try {
      // ----- 1. 普通字段 -----
      if (normalChanges.length) {
        try {
          await API.saveDetail(S.detailId, normalChanges, Object.assign({
            workflow_field_id: 704,
            workflow_data_id: curWfId
          }, PARAM));
        } catch (e) {
          normalOk = false;
          errMsg = e.message || '保存失败';
        }
      }

      // ----- 2. 状态字段（和已填字段一起提交，满足必填约束）-----
      if (hasStatus && wfTarget) {
        try {
          // 合并：已改动字段 + 状态
          const all = normalChanges.concat([
            { field_id: 704, value: wfTarget, isUpdate: true }
          ]);
          await API.saveDetail(S.detailId, all, Object.assign({
            workflow_field_id: 704,
            workflow_data_id: curWfId
          }, PARAM));
        } catch (e) {
          statusOk = false;
          if (!errMsg) errMsg = e.message || '';
        }
      }

      // ----- 3. 结果 -----
      if (normalOk && statusOk) {
        toast('保存成功，已同步到服务器');
        S.detailChanged = {};
        document.querySelectorAll('.frow.dirty').forEach(el => el.classList.remove('dirty'));
        // 刷新详情，拿到服务器最新值
        try {
          const v = await API.fetchDetail(S.detailId);
          S.detail = v;
        } catch (e) {}
      } else {
        const mask = document.createElement('div');
        mask.className = 'modal-mask';
        mask.innerHTML = `<div class="modal-box">
          <div class="modal-title" style="color:#e94b4b">${statusOk ? '保存失败' : '状态未保存'}</div>
          <div style="font-size:13.5px;line-height:1.7;padding:4px 0 14px">
            ${normalOk && !statusOk ? '<div style="color:#18a058;margin-bottom:8px">✓ 其他字段已保存</div>' : ''}
            <div style="color:#e94b4b">${esc(errMsg)}</div>
          </div>
          <button class="btn" data-cancel>知道了</button>
        </div>`;
        document.body.appendChild(mask);
        mask.querySelector('[data-cancel]').onclick = () => mask.remove();
        mask.onclick = e => { if (e.target === mask) mask.remove(); };
      }
    } finally {
      loading(false);
    }
  }

  /** 加载工作措施（子表） */
  async function loadMeasures(dataId) {
    const box = $('measure-list');
    if (!box) return;
    try {
      const list = await API.fetchDatagrid(dataId);
      renderMeasures(box, list);
    } catch (e) {
      box.innerHTML = `<div class="muted" style="padding:16px">工作措施加载失败：${esc(e.message)}</div>`;
    }
  }

  function renderMeasures(box, list) {
    if (!list || !list.length) {
      box.innerHTML = '<div class="muted" style="padding:16px;text-align:center">暂无工作措施</div>';
      return;
    }
    box.innerHTML = list.map((m, i) => {
      const code = m.code || m.content_code || '';
      const desc = m.description || m.name || m.desc || '';
      return `<div class="measure-item" data-mi="${i}">
        <div class="idx">${i + 1}</div>
        <div class="txt">
          <div>${esc(desc) || '(未命名)'}</div>
          ${code ? `<div class="muted" style="font-size:11px">${esc(code)}</div>` : ''}
        </div>
        <div class="scan-icon">⌗</div>
      </div>`;
    }).join('');

    box.querySelectorAll('.measure-item').forEach(el => {
      el.onclick = () => doScan(list[Number(el.dataset.mi)]);
    });
  }

  /** 在详情里递归找工作措施数组 */
  function findMeasures(obj, depth = 0) {
    if (!obj || depth > 5) return [];
    if (Array.isArray(obj)) {
      // 判断是不是措施列表：元素有 name/label 且含 measure/措施 特征
      if (obj.length && obj.every(x => x && typeof x === 'object' &&
          (x.name !== undefined || x.label !== undefined || x.title !== undefined))) {
        return obj;
      }
      for (const it of obj) {
        const r = findMeasures(it, depth + 1);
        if (r.length) return r;
      }
      return [];
    }
    if (typeof obj === 'object') {
      for (const k of Object.keys(obj)) {
        if (/measure|措施|measureList|action/i.test(k)) {
          const v = obj[k];
          if (Array.isArray(v) && v.length) return v;
        }
      }
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v && typeof v === 'object') {
          const r = findMeasures(v, depth + 1);
          if (r.length) return r;
        }
      }
    }
    return [];
  }

  /* ==================== 扫码 ==================== */

  /**
   * 扫码：优先用 getUserMedia 实时识别，
   * 不支持则退回文件选择
   */
  async function doScan(measure) {
    if (!measure) return;

    const gridId = measure.data_grid_id || measure.datagrid_id || '';
    const fkdId = measure.fkd_content_id || measure.id || '';

    // 浏览器降级：文件选择 + 手动输入
    const choice = await pickScanMode(measure);
    if (!choice) return;

    if (choice.mode === 'manual') {
      const code = prompt('请输入二维码内容 / 编号：', '');
      if (!code) return;
      await verifyCode(code, gridId, fkdId, measure);
      return;
    }

    // 拍照识别
    const file = choice.file;
    if (!file) return;
    loading(true);
    try {
      const code = await decodeQrFromFile(file);
      if (!code) { toast('未能识别二维码，请重试或手动输入'); return; }
      await verifyCode(code, gridId, fkdId, measure);
    } finally {
      loading(false);
    }
  }

  function pickScanMode(measure) {
    return new Promise(resolve => {
      const mask = document.createElement('div');
      mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;' +
        'display:flex;align-items:flex-end';
      const sheet = document.createElement('div');
      sheet.style.cssText = 'background:#fff;width:100%;border-radius:16px 16px 0 0;padding:8px;';

      const title = document.createElement('div');
      title.textContent = measure.name || measure.label || '扫码';
      title.style.cssText = 'padding:14px;text-align:center;font-size:13px;color:#8a94a6';
      sheet.appendChild(title);

      function mkBtn(text, cb) {
        const b = document.createElement('div');
        b.textContent = text;
        b.style.cssText = 'padding:16px;text-align:center;font-size:16px;color:#26a0fc;' +
          'border-top:1px solid #f0f2f5;cursor:pointer';
        b.onclick = () => { mask.remove(); cb(); };
        return b;
      }

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.capture = 'environment';
      fileInput.style.display = 'none';
      fileInput.onchange = () => {
        if (fileInput.files[0]) {
          mask.remove();
          resolve({ mode: 'file', file: fileInput.files[0] });
        }
      };
      sheet.appendChild(fileInput);

      sheet.appendChild(mkBtn('拍照扫描二维码', () => fileInput.click()));
      sheet.appendChild(mkBtn('手动输入编号', () => resolve({ mode: 'manual' })));
      sheet.appendChild(mkBtn('取消', () => resolve(null)));

      mask.appendChild(sheet);
      document.body.appendChild(mask);
    });
  }

  /** 用 BarcodeDetector 解二维码；不支持返回 null */
  async function decodeQrFromFile(file) {
    if (!('BarcodeDetector' in window)) {
      toast('浏览器不支持二维码识别，请手动输入');
      return null;
    }
    try {
      const bmp = await createImageBitmap(file);
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const codes = await detector.detect(bmp);
      return codes.length ? codes[0].rawValue : null;
    } catch (e) {
      return null;
    }
  }

  async function verifyCode(code, gridId, fkdId, measure) {
    loading(true);
    try {
      const d = await API.scanCode({
        contentId: API.state.contentId,
        gridId,
        fkdContentId: fkdId,
        code
      });
      if (d.success) {
        toast('✓ 扫码成功：' + code.slice(0, 20));
        if (measure) {
          measure.checked = true;
          if (S.detail) renderDetail(S.detail, null);
        }
      } else {
        toast(d.message || '校验失败');
      }
    } catch (e) {
      toast(e.message || '扫码失败');
    } finally {
      loading(false);
    }
  }

  /* ==================== 筛选面板 ==================== */

  const filterPanel = () => $('filter-panel');

  function openFilter() {
    const parts = (S.shiftFilter.values || '').split('|');
    $('f-start').value = parts[0] || '';
    $('f-end').value = parts[1] || '';
    $('q-hint').textContent = '';
    filterPanel().classList.add('show');
  }

  function closeFilter() {
    filterPanel().classList.remove('show');
  }

  /** 宽松解析用户输入的时间 → YYYY-MM-DD HH:mm:ss */
  function parseTime(v) {
    if (!v) return '';
    let t = String(v).trim().replace('T', ' ').replace(/\//g, '-');
    // 补秒
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t)) t += ':00';
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) t += ' 00:00:00';
    // 只给小时
    if (/^\d{4}-\d{2}-\d{2} \d{2}$/.test(t)) t += ':00:00';
    const d = new Date(t.replace(/-/g, '/'));
    if (isNaN(d.getTime())) return '';
    const pad = n => ('0' + n).slice(-2);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
           ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function bindQuick(shift) {
    const r = API.buildShift(shift);
    $('f-start').value = r.start;
    $('f-end').value = r.end;
    $('q-hint').textContent =
      (shift === 'day' ? '白班' : '夜班') + ' · ' + r.start + ' ~ ' + r.end;
  }

  function applyFilter() {
    const s = parseTime($('f-start').value);
    const e = parseTime($('f-end').value);

    if (!s && !e) {
      S.shiftFilter = { fields: '', ops: '', values: '' };
      closeFilter();
      loadList(true);
      return;
    }
    if (!s || !e) {
      return toast('请把开始和结束时间都填完整');
    }

    const fieldId = String(API.CFG.FIELD_PLAN_TIME);
    S.shiftFilter = { fields: fieldId, ops: 'r', values: s + '|' + e };
    closeFilter();
    loadList(true);
  }

  $('btn-login').onclick = doLogin;
  $('inp-pass').onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };
  $('btn-filter').onclick = openFilter;
  $('filter-close').onclick = closeFilter;
  $('filter-reset').onclick = () => {
    $('f-start').value = '';
    $('f-end').value = '';
    $('q-hint').textContent = '';
  };
  $('filter-apply').onclick = applyFilter;
  $('q-day').onclick = () => bindQuick('day');
  $('q-night').onclick = () => bindQuick('night');

  $('btn-more').onclick = () => loadList(false);

  $('btn-back').onclick = () => {
    showView('list');
    if (S.list && S.list.length) {
      renderList();
    } else {
      loadList(true);
    }
  };

  $('btn-logout').onclick = () => {
    if (confirm('确定退出登录？')) {
      API.clear();
      location.reload();
    }
  };

  filterPanel().onclick = (e) => {
    if (e.target === filterPanel()) closeFilter();
  };

  /* ==================== 启动 ==================== */

  (async function init() {
    // 服务器地址固定，永远不展示
    $('inp-base').value = FIXED_BASE;

    const st = API.load();
    if (st.token && st.baseUrl) {
      // 有会话 → 直接进列表
      $('inp-user').value = st.userName || '';
      showView('list');
      loading(true);
      try {
        API.state.contentId = API.CFG.CONTENT_WO;
        API.state.parameterId = API.CFG.PARAM_PM;
        await loadFilters();
        await loadList(true);
      } catch (e) {
        if (e.code === 401) {
          API.clear();
          showView('login');
          restoreCred();
          toast('登录已过期，请重新登录');
        }
      } finally {
        loading(false);
      }
    } else {
      // 没会话 → 登录页，回填记住的账号密码（不自动登录）
      showView('login');
      restoreCred();
    }
  })();

  /** 回填记住的账号密码（仅回填，不自动登录） */
  function restoreCred() {
    const remembered = localStorage.getItem(REMEMBER_KEY) === '1';
    const cred = loadCred();
    if (remembered && cred) {
      $('inp-user').value = cred.u || '';
      $('inp-pass').value = cred.p || '';
      if ($('chk-remember')) $('chk-remember').checked = true;
    } else {
      if ($('chk-remember')) $('chk-remember').checked = false;
    }
  }

  // 暴露给调试
  window.__app = { S, loadList, openDetail };
})();
