/**
 * app.js — 个人所得税计算器（定制版）交互层
 * 依赖：calc.js（注入全局变量 TaxCalc）
 * 功能：输入即时重算、localStorage 自动保存、配置 JSON 导入 / 导出、重置默认。
 * 说明：经典 <script> 加载，禁用 ES Module，确保 file:// 协议离线可运行。
 */
'use strict';
(function () {
  var T = window.TaxCalc;
  var STORAGE_KEY = 'taxCalculatorCustomV1';

  var DEFAULT_CONFIG = {
    baseSalary: 20000,                       // 基本工资（元/月）
    monthlyBonus: 5000,                      // 月度奖金（元/月）
    siMode: 'ratio',                         // 'ratio' 按比例 | 'fixed' 按固定金额
    siBase: 'basic',                         // 缴费基数：'basic' 基本工资（默认）| 'full' 基本工资+月度奖金
    city: '',                                // 参保城市：'' 自定义（手动填写）| 城市名（见 T.CITY_PRESETS）
    ratios: { pension: 8, medical: 2, unemployment: 0.5, housing: 12 }, // 百分数
    fixedSi: 3500,                           // 固定金额模式下每月五险一金合计（元）
    capEnabled: true,                        // 是否启用缴费基数上下限封顶（默认开启）
    siCap: '',                               // 缴费基数月上限（元，留空 = 不限）
    siFloor: '',                             // 缴费基数月下限（元，留空 = 不限）
    special: {
      children: 0,                           // 子女教育：子女数量（0-3）
      infants: 0,                            // 3岁以下婴幼儿照护：孩数量（0-3）
      education: false,                      // 继续教育（学历学位）：有无
      loan: false,                           // 住房贷款利息（首套）：有无
      rent: '',                              // 住房租金档位：'' | '1500' | '1100' | '800'
      elderly: 'none',                       // 赡养老人：'none' | 'sole' 独生 | 'share' 非独生
      elderlyShare: 1500                     // 非独生子女自己分摊额（元/月，上限 1500）
    },
    bonusMonths: 2,                          // 年终奖 = N 个月 ×（基本工资 + 月度奖金）
    bonusTiming: 'may',                      // may 次年5月发（默认）| dec 当年12月发
    method: 'separate'                       // separate 单独计税 | combined 合并计税
  };

  var config = deepClone(DEFAULT_CONFIG);

  // 最近一次 render 的「当前方式应纳税所得额」（随 method / 输入变化更新），供加班优化器使用
  var currentTaxable = 0;
  // 档位刻度尺：7 档年度应纳税所得额边界（元）与刻度最大值（超 96 万贴最右）
  var SCALE_BOUNDS = [0, 36000, 144000, 300000, 420000, 660000, 960000];
  var SCALE_MAX = 960000;

  /* ===================== 基础工具 ===================== */
  function $(id) { return document.getElementById(id); }
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
  function fmt(n) {
    if (typeof n !== 'number' || !isFinite(n)) n = 0;
    if (n === 0) n = 0; // 归零，避免显示 -0.00
    return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function num(id) {
    var v = parseFloat($(id).value);
    return isFinite(v) && v >= 0 ? v : 0;
  }
  function compactRate(r) { // 17.50 → 17.5
    return r.toFixed(2).replace(/\.?0+$/, '');
  }
  function round2(n) { return T.round2(n); }

  /* ===================== 城市预置查找 ===================== */
  var CITY_MAP = {};
  (function () {
    for (var i = 0; i < T.CITY_PRESETS.length; i++) {
      CITY_MAP[T.CITY_PRESETS[i].name] = T.CITY_PRESETS[i];
    }
  })();

  /* ===================== 专项附加配置归一化（含旧版金额格式迁移） ===================== */
  function normalizeSpecial(sp) {
    var out = deepClone(DEFAULT_CONFIG.special);
    if (!sp || typeof sp !== 'object') return out;
    function toNum(v, def) { var n = Number(v); return isFinite(n) ? n : def; }
    function toBool(v, def) { return typeof v === 'boolean' ? v : (toNum(v, 0) > 0); }
    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
    // 数量（旧版为金额：>3 视为 金额/2000 折算成个数）
    if ('children' in sp) {
      var cn = toNum(sp.children, 0);
      out.children = cn > 3 ? clamp(Math.round(cn / 2000), 0, 3) : clamp(Math.round(cn), 0, 3);
    }
    if ('infants' in sp) {
      var in_ = toNum(sp.infants, 0);
      out.infants = in_ > 3 ? clamp(Math.round(in_ / 2000), 0, 3) : clamp(Math.round(in_), 0, 3);
    }
    if ('education' in sp) out.education = toBool(sp.education, false);
    if ('loan' in sp) out.loan = toBool(sp.loan, false);
    if ('rent' in sp) {
      var r = sp.rent;
      if (typeof r === 'string') {
        out.rent = (r === '1500' || r === '1100' || r === '800') ? r : '';
      } else {
        var rn = toNum(r, 0);
        out.rent = rn === 1500 ? '1500' : rn === 1100 ? '1100' : rn === 800 ? '800' : '';
      }
    }
    if ('elderly' in sp) {
      if (typeof sp.elderly === 'string') {
        out.elderly = (sp.elderly === 'sole' || sp.elderly === 'share') ? sp.elderly : 'none';
      } else {
        var en = toNum(sp.elderly, 0);
        out.elderly = en >= 3000 ? 'sole' : (en > 0 ? 'share' : 'none');
        if (out.elderly === 'share') out.elderlyShare = clamp(en, 0, 1500);
      }
    }
    if ('elderlyShare' in sp) out.elderlyShare = clamp(toNum(sp.elderlyShare, 1500), 0, 1500);
    return out;
  }

  // 缴费基数上下限归一化：'' 或非负数字字符串保留，其余（含负数、非数字）归 ''（不限）
  function normCap(v) {
    if (typeof v === 'number') return (isFinite(v) && v >= 0) ? String(v) : '';
    if (typeof v === 'string') {
      var t = v.trim();
      if (t === '') return '';
      var n = Number(t);
      return (isFinite(n) && n >= 0) ? t : '';
    }
    return '';
  }

  function mergeConfig(base, incoming) {
    var out = deepClone(base);
    if (!incoming || typeof incoming !== 'object') return out;
    ['baseSalary', 'monthlyBonus', 'siMode', 'fixedSi', 'bonusMonths', 'bonusTiming', 'method', 'city', 'siBase'].forEach(function (k) {
      if (typeof incoming[k] === 'number' || typeof incoming[k] === 'string') out[k] = incoming[k];
    });
    if (typeof incoming.capEnabled === 'boolean') out.capEnabled = incoming.capEnabled;
    if ('siCap' in incoming) out.siCap = normCap(incoming.siCap);
    if ('siFloor' in incoming) out.siFloor = normCap(incoming.siFloor);
    if (incoming.ratios && typeof incoming.ratios === 'object') {
      Object.keys(base.ratios).forEach(function (k) {
        if (typeof incoming.ratios[k] === 'number') out.ratios[k] = incoming.ratios[k];
      });
    }
    out.special = normalizeSpecial(incoming.special);
    // 归一化枚举值，防止非法数据
    if (['may', 'dec'].indexOf(out.bonusTiming) < 0) out.bonusTiming = 'may';
    if (['separate', 'combined'].indexOf(out.method) < 0) out.method = 'separate';
    if (['ratio', 'fixed'].indexOf(out.siMode) < 0) out.siMode = 'ratio';
    if (out.siBase !== 'basic' && out.siBase !== 'full') out.siBase = 'basic';
    if (CITY_MAP[out.city] === undefined) out.city = '';
    return out;
  }

  function loadConfig() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return mergeConfig(DEFAULT_CONFIG, JSON.parse(raw));
    } catch (e) { /* 忽略损坏的本地配置 */ }
    return deepClone(DEFAULT_CONFIG);
  }

  function saveConfig() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch (e) { /* 隐私模式等场景忽略 */ }
  }

  /* ===================== 输入 ↔ 配置 ===================== */
  function readInputs() {
    config.baseSalary = num('baseSalary');
    config.monthlyBonus = num('monthlyBonus');
    config.ratios.pension = num('ratioPension');
    config.ratios.medical = num('ratioMedical');
    config.ratios.unemployment = num('ratioUnemployment');
    config.ratios.housing = num('ratioHousing');
    config.fixedSi = num('fixedSiAmount');
    // 专项附加：选择式
    config.special.children = Math.min(3, Math.max(0, Math.round(parseFloat($('specialChildrenCount').value) || 0)));
    config.special.infants = Math.min(3, Math.max(0, Math.round(parseFloat($('specialInfantsCount').value) || 0)));
    var edu = document.querySelector('input[name=specialEducation]:checked');
    config.special.education = edu ? edu.value === 'yes' : false;
    var ln = document.querySelector('input[name=specialLoan]:checked');
    config.special.loan = ln ? ln.value === 'yes' : false;
    config.special.rent = $('specialRent').value;
    var eld = document.querySelector('input[name=specialElderly]:checked');
    config.special.elderly = eld ? eld.value : 'none';
    config.special.elderlyShare = Math.min(1500, num('specialElderlyShare'));
    config.bonusMonths = num('bonusMonths');
    config.bonusTiming = $('bonusTiming').value;
    var m = document.querySelector('input[name=method]:checked');
    if (m) config.method = m.value;
    var s = document.querySelector('input[name=siMode]:checked');
    if (s) config.siMode = s.value;
    var b = document.querySelector('input[name=siBase]:checked');
    if (b) config.siBase = b.value;
    // 缴费基数上下限封顶：开关 + 上下限（留空 = 不限）
    config.capEnabled = $('capEnabled').checked;
    config.siCap = $('siCapInput').value.trim();
    config.siFloor = $('siFloorInput').value.trim();
    // 参保城市：只负责读取，最终归属交给 onCityChange 与 detectCityMismatch 管理
    var citySel = $('citySelect');
    config.city = citySel ? citySel.value : '';
  }

  // 手改比例 / 缴费基数上下限后，若与所选城市预置不一致 → 自动切回「自定义」
  // 注意：只在 onAnyInput 中由比例/封顶输入框的 input/change 触发，select 的 input/change 不进入此路径
  function detectCityMismatch() {
    if (!config.city) return;
    var pc = CITY_MAP[config.city];
    if (!pc || config.ratios.pension !== pc.pension || config.ratios.medical !== pc.medical ||
        config.ratios.unemployment !== pc.unemployment || config.ratios.housing !== pc.housing ||
        config.siCap !== String(pc.siCap) || config.siFloor !== String(pc.siFloor)) {
      config.city = '';
      $('citySelect').value = '';
    }
  }

  function applyConfig() {
    $('baseSalary').value = config.baseSalary;
    $('monthlyBonus').value = config.monthlyBonus;
    $('ratioPension').value = config.ratios.pension;
    $('ratioMedical').value = config.ratios.medical;
    $('ratioUnemployment').value = config.ratios.unemployment;
    $('ratioHousing').value = config.ratios.housing;
    $('fixedSiAmount').value = config.fixedSi;
    // 专项附加：选择式
    $('specialChildrenCount').value = String(config.special.children);
    $('specialInfantsCount').value = String(config.special.infants);
    document.querySelector('input[name=specialEducation][value="' + (config.special.education ? 'yes' : 'no') + '"]').checked = true;
    document.querySelector('input[name=specialLoan][value="' + (config.special.loan ? 'yes' : 'no') + '"]').checked = true;
    $('specialRent').value = config.special.rent || '';
    document.querySelector('input[name=specialElderly][value="' + config.special.elderly + '"]').checked = true;
    $('specialElderlyShare').value = config.special.elderlyShare;
    $('bonusMonths').value = config.bonusMonths;
    $('bonusTiming').value = config.bonusTiming;
    document.querySelector('input[name=siMode][value="' + config.siMode + '"]').checked = true;
    document.querySelector('input[name=method][value="' + config.method + '"]').checked = true;
    document.querySelector('input[name=siBase][value="' + config.siBase + '"]').checked = true;
    $('capEnabled').checked = !!config.capEnabled;
    $('siCapInput').value = config.siCap || '';
    $('siFloorInput').value = config.siFloor || '';
    $('citySelect').value = config.city || '';
    syncModeVisibility();
    syncSpecialVisibility();
    syncSpecialAmounts();
  }

  function syncModeVisibility() {
    $('ratioFields').style.display = config.siMode === 'ratio' ? '' : 'none';
    $('fixedFields').style.display = config.siMode === 'fixed' ? '' : 'none';
  }

  /* ===================== 专项附加：互斥 & 展示 ===================== */
  // 房贷利息与住房租金互斥：勾选其一自动清空另一个
  function enforceExclusive() {
    var s = config.special;
    if (s.rent) {
      if (s.loan) {
        s.loan = false;
        var yes = document.querySelector('input[name=specialLoan][value="yes"]');
        var no = document.querySelector('input[name=specialLoan][value="no"]');
        if (no) no.checked = true;
        if (yes) yes.checked = false;
      }
    } else if (s.loan) {
      if ($('specialRent').value !== '') $('specialRent').value = '';
    }
  }

  function syncSpecialVisibility() {
    $('elderlyShareField').style.display = config.special.elderly === 'share' ? '' : 'none';
  }

  // 每项自动金额展示（与 calc.js 标准一致）
  function syncSpecialAmounts() {
    var s = config.special;
    var st = T.SPECIAL_STANDARDS;
    var amts = {
      children: s.children * st.childEducation,
      infants: s.infants * st.infant,
      education: s.education ? st.education : 0,
      loan: s.loan ? st.loanInterest : 0,
      rent: st.rentTiers[s.rent] || 0,
      elderly: s.elderly === 'sole' ? st.elderlyOnly : (s.elderly === 'share' ? Math.min(1500, s.elderlyShare) : 0)
    };
    $('specialChildrenAmt').textContent = fmt(amts.children) + ' 元/月';
    $('specialInfantsAmt').textContent = fmt(amts.infants) + ' 元/月';
    $('specialEducationAmt').textContent = fmt(amts.education) + ' 元/月';
    $('specialLoanAmt').textContent = fmt(amts.loan) + ' 元/月';
    $('specialRentAmt').textContent = fmt(amts.rent) + ' 元/月';
    $('specialElderlyAmt').textContent = fmt(amts.elderly) + ' 元/月';
    // 分摊额输入框显示封顶后的实际值
    if (s.elderly === 'share' && $('specialElderlyShare').value !== String(s.elderlyShare)) {
      $('specialElderlyShare').value = s.elderlyShare;
    }
  }

  /* ===================== 计算 ===================== */
  function siBaseAmount() {
    return config.siBase === 'full' ? config.baseSalary + config.monthlyBonus : config.baseSalary;
  }

  // 封顶后的实际缴费基数（固定金额模式无基数概念，返回原基数；封顶关闭或上下限留空时不封顶）
  function siBaseClampedAmount() {
    var base = siBaseAmount();
    if (config.siMode === 'fixed' || !config.capEnabled) return base;
    var floor = parseFloat(config.siFloor);
    var cap = parseFloat(config.siCap);
    if (!isFinite(floor) || floor <= 0) floor = 0;
    if (!isFinite(cap) || cap <= 0) cap = 0;
    return T.clampBase(base, floor, cap);
  }

  function monthlySi() {
    var base = siBaseAmount();
    if (config.siMode === 'fixed') {
      return T.monthlySocialInsurance(base, { mode: 'fixed', fixedAmount: config.fixedSi });
    }
    // 启用封顶时把上下限传给 calc.js（0 = 该方向不限制）；关闭时传 0 / 0
    var floor = 0, cap = 0;
    if (config.capEnabled) {
      var f = parseFloat(config.siFloor), c = parseFloat(config.siCap);
      if (isFinite(f) && f > 0) floor = f;
      if (isFinite(c) && c > 0) cap = c;
    }
    return T.monthlySocialInsurance(base, {
      mode: 'ratio',
      floor: floor,
      cap: cap,
      ratios: {
        pension: config.ratios.pension / 100,
        medical: config.ratios.medical / 100,
        unemployment: config.ratios.unemployment / 100,
        housing: config.ratios.housing / 100
      }
    });
  }

  function specialMonthly() {
    var s = config.special;
    return T.monthlySpecialDeduction({
      children: s.children,
      infants: s.infants,
      education: s.education,
      loan: s.loan,
      rent: s.rent,
      elderly: s.elderly,
      elderlyShare: s.elderlyShare
    });
  }

  function compute() {
    var base = config.baseSalary;
    var mb = config.monthlyBonus;
    var monthlySalary = base + mb;
    var si = monthlySi();
    var sp = specialMonthly();
    var bonus = T.annualBonusAmount(base, mb, config.bonusMonths);
    var bonusMonth = config.bonusTiming === 'dec' ? 12 : 5;
    var annualSalaryIncome = monthlySalary * 12;
    var annual = T.calcAnnual(annualSalaryIncome, bonus, si * 12, sp * 12);
    var table = T.monthlyWithholdingTable({
      monthlySalary: monthlySalary,
      monthlySocialInsurance: si,
      monthlySpecialDeduction: sp,
      annualBonus: bonus,
      bonusMonth: bonusMonth,
      mode: config.method
    });
    // 「当前方式综合所得应纳税所得额」：单独 = 年薪 − 60000 − 五险一金×12 − 专项×12（不含年终奖）；
    // 合并 = 年薪 + 年终奖 − 60000 − 五险一金×12 − 专项×12（含年终奖）。可为负，由 annualBracket 归第 1 档。
    var selectedTotal = config.method === 'separate' ? annual.separate.total : annual.combined.total;
    var curTaxable = config.method === 'separate'
      ? annualSalaryIncome - T.BASIC_DEDUCTION_YEAR - si * 12 - sp * 12
      : annualSalaryIncome + bonus - T.BASIC_DEDUCTION_YEAR - si * 12 - sp * 12;
    return {
      base: base, mb: mb, monthlySalary: monthlySalary, si: si, sp: sp,
      siBase: siBaseAmount(), siBaseClamped: siBaseClampedAmount(), bonus: bonus, bonusMonth: bonusMonth,
      annualSalaryIncome: annualSalaryIncome, annual: annual, table: table,
      curTaxable: curTaxable, selectedTotal: selectedTotal
    };
  }

  /* ===================== 结论前置：Hero / 档位尺 / 加班优化器 ===================== */

  // Hero：月均到手 ≈ X 元/月 + 三个年度指标 + 档位徽章
  function renderHero(c) {
    var siYear = c.si * 12;
    var netYear = round2(c.annualSalaryIncome + c.bonus - siYear - c.selectedTotal);
    var monthAvg = round2(netYear / 12);
    $('heroMethodLabel').textContent = methodName();
    $('heroNetMonth').textContent = fmt(monthAvg);
    $('heroNetYear').textContent = fmt(netYear);
    $('heroTax').textContent = fmt(c.selectedTotal);
    $('heroSi').textContent = fmt(siYear);
    var b = T.annualBracket(c.curTaxable);
    $('heroBadge').textContent = '第 ' + b.level + ' 档 · 税率 ' + compactRate(b.rate * 100) + '%';
  }

  // 档位刻度尺：游标按比例定位（超 96 万贴最右）+ 距下一档文案
  function renderScale(c) {
    var t = c.curTaxable;
    var pos = Math.max(0, Math.min(1, t / SCALE_MAX)) * 100;
    $('scaleDot').style.left = pos + '%';
    $('scaleTaxable').textContent = fmt(t);
    var b = T.annualBracket(t);
    $('scaleLevel').textContent = '第 ' + b.level + ' 档 · 税率 ' + compactRate(b.rate * 100) + '%';
    if (b.level >= 7) {
      $('scaleGap').textContent = '已在最高档位（第 7 档 · 45%）';
    } else {
      $('scaleGap').textContent = '距下一档（第 ' + (b.level + 1) + ' 档）还有 ' + fmt(round2(b.upper - t)) + ' 元';
    }
  }

  // 加班优化器：按当前方式应纳税所得额 + 加班费实时算边际个税（不动年度计算主流程）
  function renderOvertime() {
    var v = parseFloat($('overtimeAmount').value);
    if (!isFinite(v) || v < 0) v = 0;
    var r = T.marginalTax(currentTaxable, v);
    $('otNet').textContent = fmt(r.netOfAdded);
    $('otRate').textContent = compactRate(r.actualRate * 100) + '%';
    $('otLevel').textContent = r.crossed ? ('第 ' + r.fromLevel + ' 档 → 第 ' + r.toLevel + ' 档') : '不升档';
    $('otAddedTax').textContent = fmt(r.addedTax);
    $('otNote').style.display = (r.addedTax > 0 || r.crossed) ? '' : 'none';
  }

  /* ===================== 渲染 ===================== */
  function methodName() { return config.method === 'separate' ? '单独计税' : '合并计税'; }

  function render(c) {
    var sep = c.annual.separate;
    var comb = c.annual.combined;
    currentTaxable = c.curTaxable;
    renderHero(c);
    renderScale(c);
    $('paramPreview').textContent = '月薪 ' + fmt(c.monthlySalary) + ' · 五险一金 ' + fmt(c.si) + '/月 · 专项 ' + fmt(c.sp) + '/月 · 年终奖 ' + fmt(c.bonus) + ' · ' + methodName();

    /* --- 输入摘要 --- */
    $('monthlySalarySummary').innerHTML = '月工资合计 = 基本工资 <b>' + fmt(c.base) + '</b> + 月度奖金 <b>' + fmt(c.mb) + '</b> = <b>' + fmt(c.monthlySalary) + '</b> 元';
    if (config.siMode === 'ratio') {
      var tr = config.ratios.pension + config.ratios.medical + config.ratios.unemployment + config.ratios.housing;
      var baseText = config.siBase === 'full' ? '基本工资+月度奖金' : '基本工资';
      var clamped = c.siBaseClamped;
      var capped = clamped !== c.siBase;
      $('siSummary').innerHTML = '月五险一金 = 缴费基数（' + baseText + '）<b>' + fmt(clamped) + '</b> × ' + compactRate(tr) + '% = <b>' + fmt(c.si) + '</b> 元'
        + (capped ? ' <span class="capped-tag">已按当地上下限封顶</span>' : '');
    } else {
      $('siSummary').innerHTML = '月五险一金（固定金额）= <b>' + fmt(c.si) + '</b> 元';
    }
    $('specialSummary').innerHTML = '月专项附加 = 各项合计 <b>' + fmt(c.sp) + '</b> 元（全年 <b>' + fmt(c.sp * 12) + '</b> 元）';
    syncSpecialAmounts();
    $('bonusAmountSummary').innerHTML = '年终奖 = <b>' + config.bonusMonths + '</b> 个月 ×（' + fmt(c.base) + ' + ' + fmt(c.mb) + '）= <b>' + fmt(c.bonus) + '</b> 元，于 <b>' + c.bonusMonth + ' 月</b>到账';
    $('bonusTimingNote').textContent = config.bonusTiming === 'may'
      ? '「次年5月发」：5 月到账的年终奖为上一年度劳动所得，按税法计入本年度汇算清缴。本计算器主视图为某一个纳税年度的完整计算：1–12 月每月发工资，年终奖在 5 月到账并体现在 5 月的预扣。'
      : '「当年12月发」：年终奖在当年 12 月随工资到账，预扣体现在 12 月。';

    /* --- 单独 vs 合并对比 --- */
    $('cmpSepTotal').textContent = fmt(sep.total);
    $('cmpSepDetail').textContent = '工资税 ' + fmt(sep.salaryTax) + ' + 年终奖税 ' + fmt(sep.bonusTax);
    $('cmpCombTotal').textContent = fmt(comb.total);
    var combinedTaxable = Math.max(0, c.annualSalaryIncome + c.bonus - T.BASIC_DEDUCTION_YEAR - c.si * 12 - c.sp * 12);
    $('cmpCombDetail').textContent = '合并应纳税所得额 ' + fmt(combinedTaxable);

    var sepBox = $('cmpSep'), combBox = $('cmpComb');
    sepBox.classList.remove('better', 'selected');
    combBox.classList.remove('better', 'selected');

    var betterText, diff = Math.abs(sep.total - comb.total);
    if (sep.total < comb.total) {
      sepBox.classList.add('better');
      betterText = '单独计税更划算 · 比合并计税少缴 ' + fmt(diff) + ' 元';
    } else if (comb.total < sep.total) {
      combBox.classList.add('better');
      betterText = '合并计税更划算 · 比单独计税少缴 ' + fmt(diff) + ' 元';
    } else {
      betterText = '两种方式税额相同';
    }
    if (config.method === 'separate') sepBox.classList.add('selected'); else combBox.classList.add('selected');

    var chip = $('cmpBetter');
    chip.textContent = (sep.total === comb.total ? '' : '🏆 ') + betterText;
    chip.className = 'cmp-result' + (sep.total === comb.total ? '' : ' good');
    $('cmpDiff').textContent = '税额差额：' + fmt(diff) + ' 元　·　当前选择：' + methodName() + '（蓝色边框高亮）';

    /* 月度预扣表 */
    var html = '';
    var rows = c.table.rows;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      html += '<tr class="' + (r.bonusArrived ? 'bonus-row' : '') + '">'
        + '<td class="month-name">' + r.month + ' 月</td>'
        + '<td>' + fmt(r.monthIncome) + '</td>'
        + '<td>' + fmt(Math.max(0, r.cumTaxable)) + '</td>'
        + '<td>' + fmt(r.totalWithheld) + '</td>'
        + '<td>' + (r.bonusWithheld > 0 ? fmt(r.bonusWithheld) : '—') + '</td>'
        + '<td>' + (r.bonusArrived ? '<span class="bonus-tag">年终奖到账</span>' : '') + '</td></tr>';
    }
    $('tblBody').innerHTML = html;

    /* 年度汇总 */
    var siYear = c.si * 12;
    var spYear = c.sp * 12;
    var totalIncome = c.annualSalaryIncome + c.bonus;
    var selectedTotal = config.method === 'separate' ? sep.total : comb.total;
    var withheld = c.table.summary.totalWithheld;
    var recon = round2(selectedTotal - withheld);
    var reconText, reconCls;
    if (recon > 0) { reconText = '补税 ' + fmt(recon); reconCls = 'positive'; }
    else if (recon < 0) { reconText = '退税 ' + fmt(-recon); reconCls = 'negative'; }
    else { reconText = '无需补退（0.00 元）'; reconCls = ''; }
    var net = round2(totalIncome - siYear - selectedTotal);
    var salaryTaxable = Math.max(0, c.annualSalaryIncome - T.BASIC_DEDUCTION_YEAR - siYear - spYear);
    var combinedTaxableY = Math.max(0, totalIncome - T.BASIC_DEDUCTION_YEAR - siYear - spYear);

    $('methodLabel').textContent = methodName();

    var items = [
      ['全年工资收入（12 × 月工资）', fmt(c.annualSalaryIncome), false, ''],
      ['全年年终奖', fmt(c.bonus), false, ''],
      ['全年收入合计', fmt(totalIncome), true, ''],
      ['全年五险一金（12 × 月五险一金）', fmt(siYear), false, ''],
      ['全年专项附加扣除（12 × 月专项附加）', fmt(spYear), false, ''],
      ['应纳税所得额（工资部分 · 单独口径）', fmt(salaryTaxable), false, ''],
      ['应纳税所得额（合并口径 · 含年终奖）', fmt(combinedTaxableY), false, ''],
      ['全年应纳（单独计税）', fmt(sep.total), false, ''],
      ['全年应纳（合并计税）', fmt(comb.total), false, ''],
      ['全年应纳（当前方式）', fmt(selectedTotal), true, ''],
      ['全年已预扣（当前方式）', fmt(withheld), false, ''],
      ['汇算清缴：补税 / 退税', reconText, false, reconCls],
      ['全年实发（到手合计）', fmt(net), true, '']
    ];

    var list = $('sumList');
    list.innerHTML = '';
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      var div = document.createElement('div');
      div.className = 'sum-item' + (it[2] ? ' total' : '') + (it[3] ? ' recon' : '');
      var k = document.createElement('span'); k.className = 'k'; k.textContent = it[0];
      var v = document.createElement('span'); v.className = 'v' + (it[3] ? ' ' + it[3] : ''); v.textContent = it[1];
      div.appendChild(k); div.appendChild(v);
      list.appendChild(div);
    }

    /* 时间影响说明 */
    var tn;
    if (config.bonusTiming === 'may') {
      tn = '「次年5月发」：5 月到账的年终奖是上一年度劳动所得，按税法计入本年度汇算清缴。就本计算器展示的这一纳税年度而言，1–12 月每月照常发工资、年终奖于 5 月到账——';
      tn += config.method === 'separate'
        ? '单独计税下，年终奖不进入每月累计预扣，5 月按「奖金 ÷ 12」月度换算表单独预扣年终奖个税。'
        : '合并计税下，年终奖并入 5 月的累计收入，5 月当月累计预扣明显上升。';
      tn += '年度口径税额与 12 月发放完全相同，二者仅影响资金到账时间（晚约 7 个月）与各月预扣节奏。';
    } else {
      tn = '「当年12月发」：年终奖于当年 12 月随工资到账，预扣体现在 12 月。';
      tn += config.method === 'separate'
        ? '单独计税下 12 月按月度换算表单独预扣年终奖税；'
        : '合并计税下并入 12 月累计收入参与预扣；';
      tn += '全年口径税额与次年 5 月发放完全相同，仅到账时间更早（12 月）。';
    }
    $('timeNote').textContent = tn;

    /* 加班优化器（随本次 recalc 同步刷新；其输入变化时另有独立监听） */
    renderOvertime();
  }

  /* ===================== 按钮动作 ===================== */
  function exportConfig() {
    var data = JSON.stringify(config, null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '个税计算器配置_' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function importConfig(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var obj = JSON.parse(reader.result);
        config = mergeConfig(DEFAULT_CONFIG, obj);
        applyConfig();
        saveConfig();
        recalc();
        alert('配置导入成功。');
      } catch (e) {
        alert('导入失败：所选文件不是有效的 JSON 配置。');
      }
    };
    reader.onerror = function () { alert('导入失败：无法读取文件。'); };
    reader.readAsText(file);
  }

  function resetConfig() {
    if (!confirm('确定恢复默认设置吗？当前配置将被覆盖。')) return;
    config = deepClone(DEFAULT_CONFIG);
    applyConfig();
    saveConfig();
    recalc();
  }

  function recalc() { render(compute()); }

  /* ===================== 参保城市下拉 ===================== */
  function buildCityOptions() {
    var sel = $('citySelect');
    var html = '<option value="" selected>自定义（手动填写）</option>';
    for (var i = 0; i < T.CITY_PRESETS.length; i++) {
      var c = T.CITY_PRESETS[i];
      html += '<option value="' + c.name + '">' + c.name + '</option>';
    }
    sel.innerHTML = html;
  }

  // 选中具体城市：填充养老/医疗/失业/公积金比例，并联动住房租金档位建议（用户仍可手动改）
  function onCityChange() {
    var cityName = $('citySelect').value;
    var c = CITY_MAP[cityName];
    if (!c) { // 「自定义」
      config.city = '';
      readInputs();
      saveConfig();
      recalc();
      return;
    }
    config.city = cityName;
    config.ratios.pension = c.pension;
    config.ratios.medical = c.medical;
    config.ratios.unemployment = c.unemployment;
    config.ratios.housing = c.housing;
    config.special.rent = String(c.rentTier);
    // 同步该市缴费基数上下限（2025 年度）到输入框与配置，用户仍可手动改
    config.siCap = String(c.siCap);
    config.siFloor = String(c.siFloor);
    $('ratioPension').value = c.pension;
    $('ratioMedical').value = c.medical;
    $('ratioUnemployment').value = c.unemployment;
    $('ratioHousing').value = c.housing;
    $('specialRent').value = String(c.rentTier);
    $('siCapInput').value = config.siCap;
    $('siFloorInput').value = config.siFloor;
    saveConfig();
    recalc();
  }

  /* ===================== 初始化 ===================== */
  function init() {
    if (!window.TaxCalc) { alert('calc.js 加载失败，请检查文件是否完整。'); return; }
    buildCityOptions();
    config = loadConfig();
    applyConfig();
    recalc();
    $('inputsWrap').addEventListener('input', onAnyInput);
    $('inputsWrap').addEventListener('change', onAnyInput);
    $('overtimeAmount').addEventListener('input', renderOvertime); // 加班优化器：独立于年度计算主流程
    $('citySelect').addEventListener('change', onCityChange);
    $('btnExport').addEventListener('click', exportConfig);
    $('btnImport').addEventListener('click', function () { $('importFile').click(); });
    $('importFile').addEventListener('change', function () {
      if (this.files && this.files[0]) importConfig(this.files[0]);
      this.value = '';
    });
    $('btnReset').addEventListener('click', resetConfig);
  }

  function onAnyInput(ev) {
    readInputs();
    enforceExclusive();
    syncModeVisibility();
    syncSpecialVisibility();
    // 仅当触发源是比例/缴费上下限输入框时，检测与所选城市预置是否不一致 → 不一致则切回「自定义」
    // （select 的 input/change 事件也会进入这里，但其 target.id 不在此列，不会误触发）
    var sid = ev && ev.target && ev.target.id;
    if (sid === 'ratioPension' || sid === 'ratioMedical' || sid === 'ratioUnemployment' ||
        sid === 'ratioHousing' || sid === 'siCapInput' || sid === 'siFloorInput') {
      detectCityMismatch();
    }
    saveConfig();
    recalc();
  }

  init();
})();