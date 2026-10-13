/**
 * calc.js — 个人所得税计算（定制版）· 纯计算逻辑
 *
 * 用法：
 *   - 浏览器：<script src="calc.js"></script>，全局变量 TaxCalc
 *   - Node：  const TaxCalc = require('./calc.js');
 *
 * 税率表依据《中华人民共和国个人所得税法》(2018 修正) 及
 * 财税〔2018〕164 号 / 财政部 税务总局公告 2021 年第 42 号、2023 年第 30 号
 * （全年一次性奖金单独计税政策延续至 2027 年 12 月 31 日），详见 README.md。
 * 本文件为纯计算逻辑，不依赖任何 DOM / 网络 / 第三方库。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.TaxCalc = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ===================== 税率表（禁止修改） ===================== */

  // 综合所得年度税率表（应纳税额 = 应纳税所得额 × 税率 − 速算扣除数）
  var ANNUAL_BRACKETS = [
    { upTo: 36000,    rate: 0.03, quick: 0 },
    { upTo: 144000,   rate: 0.10, quick: 2520 },
    { upTo: 300000,   rate: 0.20, quick: 16920 },
    { upTo: 420000,   rate: 0.25, quick: 31920 },
    { upTo: 660000,   rate: 0.30, quick: 52920 },
    { upTo: 960000,   rate: 0.35, quick: 85920 },
    { upTo: Infinity, rate: 0.45, quick: 181920 }
  ];

  // 全年一次性奖金单独计税月度换算表（奖金 ÷ 12 查表）
  var BONUS_BRACKETS = [
    { upTo: 3000,     rate: 0.03, quick: 0 },
    { upTo: 12000,    rate: 0.10, quick: 210 },
    { upTo: 25000,    rate: 0.20, quick: 1410 },
    { upTo: 35000,    rate: 0.25, quick: 2660 },
    { upTo: 55000,    rate: 0.30, quick: 4410 },
    { upTo: 80000,    rate: 0.35, quick: 7160 },
    { upTo: Infinity, rate: 0.45, quick: 15160 }
  ];

  // 基本减除费用
  var BASIC_DEDUCTION_MONTH = 5000;   // 元/月
  var BASIC_DEDUCTION_YEAR = 60000;   // 元/年

  /* ===================== 工具函数 ===================== */

  function round2(n) {
    if (typeof n !== 'number' || !isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function positive(v) {
    v = Number(v);
    return isFinite(v) && v > 0 ? v : 0;
  }

  function bracketLookup(brackets, amount) {
    for (var i = 0; i < brackets.length; i++) {
      if (amount <= brackets[i].upTo) return brackets[i];
    }
    return brackets[brackets.length - 1];
  }

  /**
   * 年度综合所得档位定位（第 1–7 档）。
   * @param {number} taxable 全年应纳税所得额（可负 / 0；负数按第 1 档下边界处理）
   * @returns {{level:number, rate:number, quick:number, lower:number, upper:number}}
   *   level 1-7 档序号；rate / quick 为该档税率 / 速算扣除数；
   *   lower / upper 为该档区间边界（第 1 档 lower = 0；第 7 档 upper = Infinity；
   *   边界值 36000 / 144000 / … 归入较低一档，与 bracketLookup 的 ≤ 语义一致）。
   */
  function annualBracket(taxable) {
    var t = Number(taxable);
    if (!isFinite(t)) t = 0;
    if (t < 0) t = 0;
    var idx = 0;
    while (idx < ANNUAL_BRACKETS.length - 1 && t > ANNUAL_BRACKETS[idx].upTo) idx++;
    var b = ANNUAL_BRACKETS[idx];
    return {
      level: idx + 1,
      rate: b.rate,
      quick: b.quick,
      lower: idx === 0 ? 0 : ANNUAL_BRACKETS[idx - 1].upTo,
      upper: b.upTo
    };
  }

  /* ===================== 核心年口径函数 ===================== */

  /**
   * 综合所得年度应纳税额
   * @param {number} annualTaxableIncome 全年应纳税所得额（已扣除 60000、五险一金、专项附加后）
   * @returns {number} 应纳税额（元）
   */
  function comprehensiveAnnualTax(annualTaxableIncome) {
    var taxable = positive(annualTaxableIncome);
    if (taxable <= 0) return 0;
    var b = bracketLookup(ANNUAL_BRACKETS, taxable);
    return round2(Math.max(0, taxable * b.rate - b.quick));
  }

  /**
   * 加班 / 额外收入边际个税（在当前应纳税所得额基础上追加 added 元）。
   * 口径：新增税额 = 综合年度税额(cur + added) − 综合年度税额(cur)（超额累进差量）。
   * @param {number} curTaxable 当前全年应纳税所得额（可负 / 0）
   * @param {number} added      新增金额（加班费，元；可为 0）
   * @returns {{addedTax:number, netOfAdded:number, actualRate:number,
   *            fromLevel:number, toLevel:number, crossed:boolean}}
   *   addedTax    全年多缴个税（round2，≥0）
   *   netOfAdded  到手净增 = added − addedTax（round2）
   *   actualRate  added > 0 时 = addedTax / added（保留原始精度，展示时再格式化），否则 0
   *   fromLevel / toLevel  追加前后的档位（annualBracket().level）
   *   crossed     fromLevel !== toLevel
   */
  function marginalTax(curTaxable, added) {
    var cur = Number(curTaxable);
    if (!isFinite(cur)) cur = 0;
    var add = Number(added);
    if (!isFinite(add)) add = 0;
    var addedTax = round2(Math.max(0, comprehensiveAnnualTax(cur + add) - comprehensiveAnnualTax(cur)));
    var netOfAdded = round2(add - addedTax);
    var actualRate = add > 0 ? addedTax / add : 0;
    var fromLevel = annualBracket(cur).level;
    var toLevel = annualBracket(cur + add).level;
    return {
      addedTax: addedTax,
      netOfAdded: netOfAdded,
      actualRate: actualRate,
      fromLevel: fromLevel,
      toLevel: toLevel,
      crossed: fromLevel !== toLevel
    };
  }

  /**
   * 全年一次性奖金单独计税应纳税额（奖金 ÷ 12 查月度换算表）
   * @param {number} annualBonus 全年一次性奖金（元）
   * @returns {number} 奖金应纳税额（元）
   */
  function annualBonusTax(annualBonus) {
    var bonus = positive(annualBonus);
    if (bonus <= 0) return 0;
    var monthly = bonus / 12;
    var b = bracketLookup(BONUS_BRACKETS, monthly);
    return round2(Math.max(0, bonus * b.rate - b.quick));
  }

  /**
   * 年度计税汇总（单独 vs 合并）
   * @param {number} annualSalaryIncome          全年工资收入（12 × 月工资）
   * @param {number} annualBonus                 全年一次性奖金
   * @param {number} annualSocialInsurance       全年五险一金
   * @param {number} annualSpecialDeduction      全年专项附加扣除
   * @returns {{separate:{salaryTax:number,bonusTax:number,total:number}, combined:{total:number}}}
   */
  function calcAnnual(annualSalaryIncome, annualBonus, annualSocialInsurance, annualSpecialDeduction) {
    var salaryIncome = positive(annualSalaryIncome);
    var bonus = positive(annualBonus);
    var si = positive(annualSocialInsurance);
    var sp = positive(annualSpecialDeduction);

    // 单独计税：工资按年表，年终奖按月表
    var salaryTaxable = salaryIncome - BASIC_DEDUCTION_YEAR - si - sp;
    var salaryTax = comprehensiveAnnualTax(salaryTaxable);
    var bonusTax = annualBonusTax(bonus);
    var separateTotal = round2(salaryTax + bonusTax);

    // 合并计税：全部并入综合所得
    var combinedTaxable = salaryIncome + bonus - BASIC_DEDUCTION_YEAR - si - sp;
    var combinedTotal = comprehensiveAnnualTax(combinedTaxable);

    return {
      separate: { salaryTax: salaryTax, bonusTax: bonusTax, total: separateTotal },
      combined: { total: combinedTotal }
    };
  }

  /* ===================== 辅助函数 ===================== */

  /**
   * 缴费基数上下限封顶（clamp）。
   * floor / cap 为 空、0 或非正数时，对应方向不限制；返回 clamp 后的基数（元/月，保留 2 位小数）。
   * 封顶只作用于「缴费基数」，供五险一金比例模式在乘比例前调用；固定金额模式与年终奖计算不受影响。
   * @param {number} base  原始缴费基数（元/月）
   * @param {number|string|''|null|undefined} floor 下限（元/月），0 / 空 / 负数 = 不限下限
   * @param {number|string|''|null|undefined} cap   上限（元/月），0 / 空 / 负数 = 不限上限
   * @returns {number} clamp 后的基数（元/月）
   */
  function clampBase(base, floor, cap) {
    var b = positive(base);
    var f = Number(floor);
    var c = Number(cap);
    if (isFinite(f) && f > 0 && b < f) b = f;
    if (isFinite(c) && c > 0 && b > c) b = c;
    return round2(b);
  }

  /**
   * 月五险一金（专项扣除）
   * @param {number} baseSalary 缴费基数（元/月）：由调用方决定——app.js 按 siBase 选择
   *   'basic' 传基本工资、'full' 传基本工资 + 月度奖金；tests.js 直接传基数。
   * @param {{mode:'ratio'|'fixed', ratios?:{pension:number,medical:number,unemployment:number,housing:number},
   *          fixedAmount?:number, floor?:number|string, cap?:number|string}} opts
   *   ratio 模式：ratios 为小数比例（0.08 表示 8%），月额 = clampBase(缴费基数, floor, cap) × 比例合计；
   *   fixed 模式：直接给定每月五险一金合计金额（与缴费基数无关，不受上下限封顶影响）；
   *   floor / cap 可传 0 / 空串 / 负数表示该方向不限制。
   * @returns {number} 每月五险一金（元）
   */
  function monthlySocialInsurance(baseSalary, opts) {
    opts = opts || {};
    var base = positive(baseSalary);
    if (opts.mode === 'fixed') {
      return round2(positive(opts.fixedAmount));
    }
    var r = opts.ratios || {};
    var rate = positive(r.pension) + positive(r.medical) + positive(r.unemployment) + positive(r.housing);
    // 顺序：先按 siBase 取基数 → clamp 上下限封顶 → 再乘比例合计
    var clamped = clampBase(base, opts.floor, opts.cap);
    return round2(clamped * rate);
  }

  /**
   * 年终奖金额 = N 个月 ×（基本工资 + 月度奖金）
   * @param {number} baseSalary   基本工资（元/月）
   * @param {number} monthlyBonus 月度奖金（元/月）
   * @param {number} nMonths      N（允许小数，默认 2）
   * @returns {number} 年终奖金额（元）
   */
  function annualBonusAmount(baseSalary, monthlyBonus, nMonths) {
    var base = positive(baseSalary);
    var mb = positive(monthlyBonus);
    var n = positive(nMonths);
    return round2((base + mb) * n);
  }

  /**
   * 月度累计预扣预缴明细表（12 行）
   * 规则：
   *   累计收入      = 截至本月工资之和（合并计税模式下自年终奖到账月起含年终奖；单独计税模式下年终奖不计入）
   *   累计减除费用  = 5000 × 月份数
   *   累计五险一金  = 月五险一金 × 月份数
   *   累计专项附加  = 月专项附加 × 月份数
   *   累计应纳税所得额 = 累计收入 − 累计减除费用 − 累计五险一金 − 累计专项附加
   *   累计应纳税额  = 累计应纳税所得额 × 年表税率 − 年表速算扣除数（≤0 时按 0）
   *   当月预扣      = 累计应纳税额 − 上月累计已预扣（单独模式下年终奖到账月另按月度换算表预扣奖金税）
   * @param {{
   *   monthlySalary:number,              月工资（基本工资 + 月度奖金）
   *   monthlySocialInsurance:number,     月五险一金
   *   monthlySpecialDeduction:number,    月专项附加扣除
   *   annualBonus:number,                全年一次性奖金
   *   bonusMonth:number,                 年终奖到账月份（1-12，默认 12）
   *   mode:'separate'|'combined'         计税方式
   * }} cfg
   * @returns {{rows:Array, summary:{totalSalaryWithheld:number,totalBonusWithheld:number,totalWithheld:number}}}
   */
  function monthlyWithholdingTable(cfg) {
    cfg = cfg || {};
    var monthlySalary = positive(cfg.monthlySalary);
    var si = positive(cfg.monthlySocialInsurance);
    var sp = positive(cfg.monthlySpecialDeduction);
    var bonus = positive(cfg.annualBonus);
    var bonusMonth = Math.min(12, Math.max(1, Math.round(positive(cfg.bonusMonth) || 12)));
    var mode = cfg.mode === 'combined' ? 'combined' : 'separate';

    var rows = [];
    var cumSalaryIncome = 0;
    var cumTax = 0;
    var totalSalaryWithheld = 0;
    var totalBonusWithheld = 0;

    for (var m = 1; m <= 12; m++) {
      cumSalaryIncome = round2(cumSalaryIncome + monthlySalary);
      var bonusArrived = m === bonusMonth;
      var monthIncome = round2(monthlySalary + (bonusArrived ? bonus : 0));
      var cumIncome = round2(cumSalaryIncome + (mode === 'combined' && m >= bonusMonth ? bonus : 0));
      var cumDeduction = round2(BASIC_DEDUCTION_MONTH * m + si * m + sp * m);
      var cumTaxable = round2(cumIncome - cumDeduction);
      var cumTaxThis = comprehensiveAnnualTax(cumTaxable); // 对 ≤0 归零
      var salaryWithheld = Math.max(0, cumTaxThis - cumTax);
      var bonusWithheld = (mode === 'separate' && bonusArrived) ? annualBonusTax(bonus) : 0;
      cumTax = cumTaxThis;
      totalSalaryWithheld = round2(totalSalaryWithheld + salaryWithheld);
      totalBonusWithheld = round2(totalBonusWithheld + bonusWithheld);

      rows.push({
        month: m,
        monthIncome: monthIncome,
        cumSalaryIncome: cumSalaryIncome,
        cumIncome: cumIncome,
        cumTaxable: cumTaxable,
        cumTax: cumTaxThis,
        salaryWithheld: salaryWithheld,
        bonusWithheld: bonusWithheld,
        totalWithheld: round2(salaryWithheld + bonusWithheld),
        bonusArrived: bonusArrived
      });
    }

    return {
      rows: rows,
      summary: {
        totalSalaryWithheld: totalSalaryWithheld,
        totalBonusWithheld: totalBonusWithheld,
        totalWithheld: round2(totalSalaryWithheld + totalBonusWithheld)
      }
    };
  }

  /* ===================== 城市预置 & 专项附加标准（增量） ===================== */

  /**
   * 全国主要城市五险一金常见个人比例预置。
   * 养老 / 医疗 / 失业个人比例全国统一：8% / 2% / 0.5%；
   * 公积金：上海 7%，其余城市 12%（5%–12% 由单位自选，此处为该市常见默认值，仅供参考）。
   * rentTier：用于联动住房租金档位建议（1500 直辖市·省会·计划单列市 / 1100 市区人口>100 万）。
   * siCap / siFloor：职工基本养老保险（个人）缴费基数月上限 / 月下限（元），取「2025 年度」
   *   最新公布值（多数省份 2025-07-01 至 2026-06-30 缴费年度，江苏等少数省份按自然年 2025）。
   *   养老 / 医疗 / 失业 / 工伤 / 公积金共用这一组口径近似（公积金上下限与社保略有差异），详见 README。
   * 共 39 城，顺序固定。
   */
  var CITY_PRESETS = [
    { name: '北京', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 35811, siFloor: 7162 },
    { name: '天津', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 25620, siFloor: 5124 },
    { name: '上海', pension: 8, medical: 2, unemployment: 0.5, housing: 7, rentTier: 1500, siCap: 37302, siFloor: 7460 },
    { name: '重庆', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 22017, siFloor: 4404 },
    { name: '深圳', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 27549, siFloor: 4775 },
    { name: '广州', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 27549, siFloor: 5510 },
    { name: '大连', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 21792, siFloor: 4359 },
    { name: '青岛', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 22518, siFloor: 4504 },
    { name: '宁波', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 25299, siFloor: 4986 },
    { name: '厦门', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 22607, siFloor: 4043 },
    { name: '杭州', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 25299, siFloor: 4986 },
    { name: '南京', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 24762, siFloor: 4952 },
    { name: '苏州', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1100, siCap: 24762, siFloor: 4952 },
    { name: '无锡', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1100, siCap: 24762, siFloor: 4952 },
    { name: '成都', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 22938, siFloor: 4588 },
    { name: '武汉', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 22488, siFloor: 4498 },
    { name: '西安', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 23250, siFloor: 4650 },
    { name: '长沙', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 20361, siFloor: 4072 },
    { name: '郑州', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 19155, siFloor: 3831 },
    { name: '合肥', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 21556, siFloor: 4311 },
    { name: '福州', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 22607, siFloor: 4043 },
    { name: '济南', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 22518, siFloor: 4504 },
    { name: '沈阳', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 21792, siFloor: 4359 },
    { name: '南昌', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 19575, siFloor: 3915 },
    { name: '昆明', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 21789, siFloor: 4357 },
    { name: '贵阳', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 21973.5, siFloor: 4394.7 },
    { name: '南宁', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 20715, siFloor: 4143 },
    { name: '哈尔滨', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 22710, siFloor: 4542 },
    { name: '长春', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 21966, siFloor: 4393.2 },
    { name: '石家庄', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 20034, siFloor: 4007 },
    { name: '太原', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 20991, siFloor: 4198 },
    { name: '兰州', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 22014, siFloor: 4403 },
    { name: '乌鲁木齐', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 25344, siFloor: 5069 },
    { name: '海口', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1500, siCap: 24564, siFloor: 4912.8 },
    { name: '东莞', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1100, siCap: 27549, siFloor: 4775 },
    { name: '佛山', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1100, siCap: 27549, siFloor: 4775 },
    { name: '珠海', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1100, siCap: 27549, siFloor: 4775 },
    { name: '中山', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1100, siCap: 27549, siFloor: 4775 },
    { name: '惠州', pension: 8, medical: 2, unemployment: 0.5, housing: 12, rentTier: 1100, siCap: 27549, siFloor: 4775 }
  ];

  /**
   * 专项附加扣除月标准（国发〔2023〕13 号，全国统一）。
   * 大病医疗不在此处：年度据实扣除、汇算清缴时填报。
   */
  var SPECIAL_STANDARDS = {
    childEducation: 2000,   // 子女教育：元/月·子女
    infant: 2000,           // 3 岁以下婴幼儿照护：元/月·孩
    education: 400,         // 继续教育（学历学位）：元/月
    loanInterest: 1000,     // 住房贷款利息（首套）：元/月
    rentTiers: { '1500': 1500, '1100': 1100, '800': 800 }, // 住房租金按城市档位
    elderlyOnly: 3000       // 赡养老人（独生子女）：元/月
  };

  /**
   * 月专项附加扣除合计（选择式 → 自动标准金额）
   * @param {{children?:number, infants?:number, education?:boolean, loan?:boolean,
   *          rent?:string, elderly?:string, elderlyShare?:number}} cfg
   *   children / infants 为数量；education / loan 为布尔；
   *   rent 为档位键 ''|'1500'|'1100'|'800'（非空时与房贷利息互斥，房贷忽略）；
   *   elderly 为 'none'|'sole'|'share'；elderlyShare 为非独生子女自己分摊额（封顶 1500）。
   * @returns {number} 月专项附加扣除合计（元）
   */
  function monthlySpecialDeduction(cfg) {
    cfg = cfg || {};
    var total = 0;
    total += positive(cfg.children) * SPECIAL_STANDARDS.childEducation;
    total += positive(cfg.infants) * SPECIAL_STANDARDS.infant;
    if (cfg.education) total += SPECIAL_STANDARDS.education;
    var rentKey = String(cfg.rent || '');
    var rentAmt = SPECIAL_STANDARDS.rentTiers[rentKey] || 0;
    if (rentAmt > 0) {
      total += rentAmt; // 住房租金优先：租住则不再享受房贷利息扣除
    } else if (cfg.loan) {
      total += SPECIAL_STANDARDS.loanInterest;
    }
    if (cfg.elderly === 'sole') {
      total += SPECIAL_STANDARDS.elderlyOnly;
    } else if (cfg.elderly === 'share') {
      total += Math.min(1500, positive(cfg.elderlyShare));
    }
    return round2(total);
  }

  /* ===================== 导出（UMD） ===================== */
  return {
    ANNUAL_BRACKETS: ANNUAL_BRACKETS,
    BONUS_BRACKETS: BONUS_BRACKETS,
    BASIC_DEDUCTION_MONTH: BASIC_DEDUCTION_MONTH,
    BASIC_DEDUCTION_YEAR: BASIC_DEDUCTION_YEAR,
    round2: round2,
    clampBase: clampBase,
    annualBracket: annualBracket,
    comprehensiveAnnualTax: comprehensiveAnnualTax,
    marginalTax: marginalTax,
    annualBonusTax: annualBonusTax,
    monthlySocialInsurance: monthlySocialInsurance,
    annualBonusAmount: annualBonusAmount,
    calcAnnual: calcAnnual,
    monthlyWithholdingTable: monthlyWithholdingTable,
    CITY_PRESETS: CITY_PRESETS,
    SPECIAL_STANDARDS: SPECIAL_STANDARDS,
    monthlySpecialDeduction: monthlySpecialDeduction
  };
});
