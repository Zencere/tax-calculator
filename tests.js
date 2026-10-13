/**
 * tests.js — 个人所得税计算器（定制版）单元测试
 * 运行：node tests.js   （无任何 npm 依赖，仅使用 Node 内置能力）
 * 断言官方权威案例 + 税率表边界 + 月度累计预扣表一致性。
 */
'use strict';

var TaxCalc = require('./calc.js');

var passed = 0;
var failed = 0;

function closeTo(a, b, eps) {
  eps = eps || 1e-6;
  return Math.abs(a - b) <= eps;
}

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log('PASS  ' + name);
  } else {
    failed++;
    console.log('FAIL  ' + name + (detail ? '  实际: ' + detail : ''));
  }
}

/* ============ 官方权威案例 1：老李 ============ */
// 全年工资 200000、年终奖 24000、全年扣除（五险一金 + 专项附加）44000
// calcAnnual 中全年扣除按五险一金 / 专项附加分开传参（仅合计参与运算）
var li = TaxCalc.calcAnnual(200000, 24000, 30000, 14000); // 全年扣除合计 44000

check('案例1 老李：单独计税工资税 = 7080', closeTo(li.separate.salaryTax, 7080), String(li.separate.salaryTax));
check('案例1 老李：单独计税年终奖税 = 720', closeTo(li.separate.bonusTax, 720), String(li.separate.bonusTax));
check('案例1 老李：单独计税合计 = 7800', closeTo(li.separate.total, 7800), String(li.separate.total));
check('案例1 老李：合并计税合计 = 9480', closeTo(li.combined.total, 9480), String(li.combined.total));
check('案例1 老李：单独计税更划算', li.separate.total < li.combined.total, li.separate.total + ' vs ' + li.combined.total);

/* ============ 官方权威案例 2：小张 ============ */
// 全年工资 120000、年终奖 60000、全年扣除 40000
var zhang = TaxCalc.calcAnnual(120000, 60000, 25000, 15000); // 全年扣除合计 40000

check('案例2 小张：单独计税工资税 = 600', closeTo(zhang.separate.salaryTax, 600), String(zhang.separate.salaryTax));
check('案例2 小张：单独计税年终奖税 = 5790', closeTo(zhang.separate.bonusTax, 5790), String(zhang.separate.bonusTax));
check('案例2 小张：单独计税合计 = 6390', closeTo(zhang.separate.total, 6390), String(zhang.separate.total));
check('案例2 小张：合并计税合计 = 5480', closeTo(zhang.combined.total, 5480), String(zhang.combined.total));
check('案例2 小张：合并计税更划算', zhang.combined.total < zhang.separate.total, zhang.combined.total + ' vs ' + zhang.separate.total);

/* ============ 案例 3：五险一金只按基本工资 ============ */
// 基本工资 20000、月度奖金 5000、比例 8+2+0.5+12 = 22.5% → 4500（而非 5625）
var siRatio = TaxCalc.monthlySocialInsurance(20000, {
  mode: 'ratio',
  ratios: { pension: 0.08, medical: 0.02, unemployment: 0.005, housing: 0.12 }
});
check('案例3：月五险一金 = 4500（仅按基本工资，不含奖金）', closeTo(siRatio, 4500), String(siRatio));
check('案例3：确实未把奖金计入基数（4500 ≠ 5625）', Math.abs(siRatio - 5625) > 1, String(siRatio));

/* ============ 案例 4：年终奖 = N ×（基本工资 + 月度奖金） ============ */
var bonusAmount = TaxCalc.annualBonusAmount(20000, 5000, 2);
check('案例4：年终奖 = 50000（2 × (20000 + 5000)）', closeTo(bonusAmount, 50000), String(bonusAmount));
var bonusAmount25 = TaxCalc.annualBonusAmount(20000, 5000, 2.5);
check('案例4：N = 2.5 时年终奖 = 62500（支持小数）', closeTo(bonusAmount25, 62500), String(bonusAmount25));

/* ============ 附加：基础接口与税率表边界 ============ */
check('接口：应纳税所得额 0 → 税额 0', TaxCalc.comprehensiveAnnualTax(0) === 0);
check('接口：负应纳税所得额 → 税额 0', TaxCalc.comprehensiveAnnualTax(-10000) === 0);
check('接口：年表边界 36000 → 1080', closeTo(TaxCalc.comprehensiveAnnualTax(36000), 1080), String(TaxCalc.comprehensiveAnnualTax(36000)));
check('接口：年表边界 36001 → 1080.10', closeTo(TaxCalc.comprehensiveAnnualTax(36001), 1080.1), String(TaxCalc.comprehensiveAnnualTax(36001)));
check('接口：年表 144000 → 11880', closeTo(TaxCalc.comprehensiveAnnualTax(144000), 11880), String(TaxCalc.comprehensiveAnnualTax(144000)));
check('接口：年表 960000+ → 45% 档 249120', closeTo(TaxCalc.comprehensiveAnnualTax(960001), 960001 * 0.45 - 181920), String(TaxCalc.comprehensiveAnnualTax(960001)));
check('接口：年终奖为 0 → 税额 0', TaxCalc.annualBonusTax(0) === 0);
check('接口：奖金表边界 36000（月均 3000）→ 1080', closeTo(TaxCalc.annualBonusTax(36000), 1080), String(TaxCalc.annualBonusTax(36000)));
check('接口：奖金表边界 36001 → 3390.10', closeTo(TaxCalc.annualBonusTax(36001), 3390.1), String(TaxCalc.annualBonusTax(36001)));
check('接口：固定金额模式五险一金', closeTo(TaxCalc.monthlySocialInsurance(99999, { mode: 'fixed', fixedAmount: 1234.56 }), 1234.56), String(TaxCalc.monthlySocialInsurance(99999, { mode: 'fixed', fixedAmount: 1234.56 })));

/* ============ 附加：月度累计预扣表（合并模式） ============ */
// 月工资 20000、月五险一金 3500、月专项附加 2000、年终奖 50000、5 月到账
var tableComb = TaxCalc.monthlyWithholdingTable({
  monthlySalary: 20000,
  monthlySocialInsurance: 3500,
  monthlySpecialDeduction: 2000,
  annualBonus: 50000,
  bonusMonth: 5,
  mode: 'combined'
});
check('月度表：共 12 行', tableComb.rows.length === 12, String(tableComb.rows.length));
check('月度表：合并模式 1 月当月收入 = 20000（无年终奖）', closeTo(tableComb.rows[0].monthIncome, 20000), String(tableComb.rows[0].monthIncome));
check('月度表：合并模式 5 月当月收入 = 70000（含年终奖）', closeTo(tableComb.rows[4].monthIncome, 70000), String(tableComb.rows[4].monthIncome));
check('月度表：合并模式 5 月累计收入含年终奖（=150000）', closeTo(tableComb.rows[4].cumIncome, 150000), String(tableComb.rows[4].cumIncome));
// 全年合并口径：收入 240000+50000=290000 − 60000 − 42000 − 24000 = 164000 → 20% 档 → 32800 − 16920 = 15880
var expectedCombined = TaxCalc.calcAnnual(240000, 50000, 42000, 24000).combined.total;
check('月度表：合并模式全年预扣合计 = 合并年度税额 15880', closeTo(tableComb.summary.totalWithheld, expectedCombined), tableComb.summary.totalWithheld + ' vs ' + expectedCombined);

/* ============ 附加：月度累计预扣表（单独模式） ============ */
var tableSep = TaxCalc.monthlyWithholdingTable({
  monthlySalary: 20000,
  monthlySocialInsurance: 3500,
  monthlySpecialDeduction: 2000,
  annualBonus: 50000,
  bonusMonth: 5,
  mode: 'separate'
});
check('月度表：单独模式 5 月累计收入不含年终奖（=100000）', closeTo(tableSep.rows[4].cumSalaryIncome, 100000), String(tableSep.rows[4].cumSalaryIncome));
check('月度表：单独模式 5 月预扣年终奖税 = 4790', closeTo(tableSep.rows[4].bonusWithheld, 4790), String(tableSep.rows[4].bonusWithheld));
var expectedSep = TaxCalc.calcAnnual(240000, 50000, 42000, 24000).separate.total;
check('月度表：单独模式全年预扣合计 = 单独年度税额 13670', closeTo(tableSep.summary.totalWithheld, expectedSep), tableSep.summary.totalWithheld + ' vs ' + expectedSep);

/* ============ 增量改造断言：城市预置 / 专项附加 / 缴费基数 ============ */
var cityMap = {};
TaxCalc.CITY_PRESETS.forEach(function (c) { cityMap[c.name] = c; });

check('改造一：城市预置共 39 个', TaxCalc.CITY_PRESETS.length === 39, String(TaxCalc.CITY_PRESETS.length));
check('改造一：上海公积金 = 7', cityMap['上海'].housing === 7, String(cityMap['上海'].housing));
check('改造一：北京公积金 = 12', cityMap['北京'].housing === 12, String(cityMap['北京'].housing));
check('改造一：深圳公积金 = 12', cityMap['深圳'].housing === 12, String(cityMap['深圳'].housing));
['苏州', '无锡', '东莞', '佛山', '珠海', '中山', '惠州'].forEach(function (n) {
  check('改造一：' + n + ' rentTier = 1100', cityMap[n].rentTier === 1100, String(cityMap[n].rentTier));
});
['北京', '上海', '广州', '杭州'].forEach(function (n) {
  check('改造一：' + n + ' rentTier = 1500', cityMap[n].rentTier === 1500, String(cityMap[n].rentTier));
});

check('改造二：2 子女 + 1 婴幼儿 + 继续教育 = 6400',
  closeTo(TaxCalc.monthlySpecialDeduction({ children: 2, infants: 1, education: true }), 6400),
  String(TaxCalc.monthlySpecialDeduction({ children: 2, infants: 1, education: true })));

check('改造二：独生子女赡养 = 3000',
  closeTo(TaxCalc.monthlySpecialDeduction({ elderly: 'sole' }), 3000),
  String(TaxCalc.monthlySpecialDeduction({ elderly: 'sole' })));
check('改造二：非独生子女分摊 1000 → 1000',
  closeTo(TaxCalc.monthlySpecialDeduction({ elderly: 'share', elderlyShare: 1000 }), 1000),
  String(TaxCalc.monthlySpecialDeduction({ elderly: 'share', elderlyShare: 1000 })));
check('改造二：非独生子女分摊 2000 → 封顶 1500',
  closeTo(TaxCalc.monthlySpecialDeduction({ elderly: 'share', elderlyShare: 2000 }), 1500),
  String(TaxCalc.monthlySpecialDeduction({ elderly: 'share', elderlyShare: 2000 })));

check('改造二：租房 1500 且房贷 true → 只算 1500（互斥）',
  closeTo(TaxCalc.monthlySpecialDeduction({ rent: '1500', loan: true }), 1500),
  String(TaxCalc.monthlySpecialDeduction({ rent: '1500', loan: true })));
check('改造二：无租房 + 房贷 → 1000',
  closeTo(TaxCalc.monthlySpecialDeduction({ rent: '', loan: true }), 1000),
  String(TaxCalc.monthlySpecialDeduction({ rent: '', loan: true })));

var fullRatios = { pension: 0.08, medical: 0.02, unemployment: 0.005, housing: 0.12 };
check('改造三：全额工资基数 25000 × 22.5% = 5625',
  closeTo(TaxCalc.monthlySocialInsurance(25000, { mode: 'ratio', ratios: fullRatios }), 5625),
  String(TaxCalc.monthlySocialInsurance(25000, { mode: 'ratio', ratios: fullRatios })));
check('改造三：基本工资基数 20000 × 22.5% = 4500（对照，默认）',
  closeTo(TaxCalc.monthlySocialInsurance(20000, { mode: 'ratio', ratios: fullRatios }), 4500),
  String(TaxCalc.monthlySocialInsurance(20000, { mode: 'ratio', ratios: fullRatios })));

/* ============ 改造四：缴费基数上下限封顶 ============ */
var bj = cityMap['北京']; // siCap 35811 / siFloor 7162（2025 年度）
var rateSum = 0.08 + 0.02 + 0.005 + 0.12; // 与实现一致：四比例求和（默认 22.5%）后再乘基数

// a) 封顶生效：北京 cap=35811、基数 40000 > 35811 → 按 35811 × 22.5%
var capOn = TaxCalc.monthlySocialInsurance(40000, { mode: 'ratio', ratios: fullRatios, floor: bj.siFloor, cap: bj.siCap });
check('改造四a：封顶生效——基数 40000 > 上限 35811，按 35811 × 22.5% = ' + TaxCalc.round2(35811 * rateSum),
  closeTo(capOn, TaxCalc.round2(35811 * rateSum), 1e-6), String(capOn));
check('改造四a2：未封顶对照——基数 30000 < 上限 35811，按 30000 × 22.5% = 6750',
  closeTo(TaxCalc.monthlySocialInsurance(30000, { mode: 'ratio', ratios: fullRatios, floor: bj.siFloor, cap: bj.siCap }), 6750),
  String(TaxCalc.monthlySocialInsurance(30000, { mode: 'ratio', ratios: fullRatios, floor: bj.siFloor, cap: bj.siCap })));

// b) 封顶关闭（cap=0 / floor=0）：基数 40000 不再封顶 → 40000 × 22.5% = 9000
var capOff = TaxCalc.monthlySocialInsurance(40000, { mode: 'ratio', ratios: fullRatios, floor: 0, cap: 0 });
check('改造四b：封顶关闭（cap=0, floor=0）——基数 40000 × 22.5% = 9000',
  closeTo(capOff, TaxCalc.round2(40000 * 0.225), 1e-6), String(capOff));

// c) 下限生效：基数 5000 < 下限 7162 → 按 7162 × 22.5%
var floorOn = TaxCalc.monthlySocialInsurance(5000, { mode: 'ratio', ratios: fullRatios, floor: bj.siFloor, cap: bj.siCap });
check('改造四c：下限生效——基数 5000 < 下限 7162，按 7162 × 22.5% = ' + TaxCalc.round2(7162 * 0.225),
  closeTo(floorOn, TaxCalc.round2(7162 * 0.225), 1e-6), String(floorOn));

// d) 固定金额模式不受封顶影响
check('改造四d：固定金额模式不受封顶影响（fixedAmount 3500 原样返回）',
  closeTo(TaxCalc.monthlySocialInsurance(40000, { mode: 'fixed', fixedAmount: 3500, floor: bj.siFloor, cap: bj.siCap }), 3500),
  String(TaxCalc.monthlySocialInsurance(40000, { mode: 'fixed', fixedAmount: 3500, floor: bj.siFloor, cap: bj.siCap })));

// e) siBase=basic 时封顶作用于基本工资基数（35000 < 35811 → 不封顶；若 36000 > 35811 → 封顶）
check('改造四e1：siBase=basic、基本工资 35000 < 上限 35811 → 35000 × 22.5% = 7875',
  closeTo(TaxCalc.monthlySocialInsurance(35000, { mode: 'ratio', ratios: fullRatios, floor: bj.siFloor, cap: bj.siCap }), TaxCalc.round2(35000 * 0.225), 1e-6),
  String(TaxCalc.monthlySocialInsurance(35000, { mode: 'ratio', ratios: fullRatios, floor: bj.siFloor, cap: bj.siCap })));
check('改造四e2：siBase=basic、基本工资 36000 > 上限 35811 → 按 35811 × 22.5%',
  closeTo(TaxCalc.monthlySocialInsurance(36000, { mode: 'ratio', ratios: fullRatios, floor: bj.siFloor, cap: bj.siCap }), TaxCalc.round2(35811 * rateSum), 1e-6),
  String(TaxCalc.monthlySocialInsurance(36000, { mode: 'ratio', ratios: fullRatios, floor: bj.siFloor, cap: bj.siCap })));

// f) CITY_PRESETS 共 39 城、每城均有正数 siCap/siFloor；抽查基准城市
check('改造四f：39 城每城均有正数 siCap / siFloor',
  TaxCalc.CITY_PRESETS.every(function (c) { return typeof c.siCap === 'number' && c.siCap > 0 && typeof c.siFloor === 'number' && c.siFloor > 0; }),
  '');
check('改造四f2：北京 siCap=35811 / siFloor=7162', bj.siCap === 35811 && bj.siFloor === 7162, String(bj.siCap) + '/' + String(bj.siFloor));
check('改造四f3：上海 siCap=37302 / siFloor=7460', cityMap['上海'].siCap === 37302 && cityMap['上海'].siFloor === 7460, String(cityMap['上海'].siCap) + '/' + String(cityMap['上海'].siFloor));
check('改造四f4：深圳 siCap=27549 / siFloor=4775', cityMap['深圳'].siCap === 27549 && cityMap['深圳'].siFloor === 4775, String(cityMap['深圳'].siCap) + '/' + String(cityMap['深圳'].siFloor));
check('改造四f5：广州 siCap=27549 / siFloor=5510', cityMap['广州'].siCap === 27549 && cityMap['广州'].siFloor === 5510, String(cityMap['广州'].siCap) + '/' + String(cityMap['广州'].siFloor));

// g) clampBase 边界：floor / cap 为 0 / 空 / 负数时对应方向不限
check('改造四g1：clampBase 下限不限（floor=0 / 空串）',
  closeTo(TaxCalc.clampBase(3000, 0, 0), 3000, 1e-6) && closeTo(TaxCalc.clampBase(3000, '', 0), 3000, 1e-6),
  String(TaxCalc.clampBase(3000, 0, 0)));
check('改造四g2：clampBase 上限不限（cap=0 / 空串 / 负数）',
  closeTo(TaxCalc.clampBase(40000, 0, 0), 40000, 1e-6) && closeTo(TaxCalc.clampBase(40000, 0, ''), 40000, 1e-6) && closeTo(TaxCalc.clampBase(40000, 0, -5), 40000, 1e-6),
  String(TaxCalc.clampBase(40000, 0, -5)));
check('改造四g3：clampBase 上下限同时生效（40000→35811，5000→7000，10000 不变）',
  closeTo(TaxCalc.clampBase(40000, 7000, 35811), 35811, 1e-6) && closeTo(TaxCalc.clampBase(5000, 7000, 35811), 7000, 1e-6) && closeTo(TaxCalc.clampBase(10000, 7000, 35811), 10000, 1e-6),
  String(TaxCalc.clampBase(40000, 7000, 35811)));

/* ============ 改造五：annualBracket 档位定位 ============ */
function brk(t) { return TaxCalc.annualBracket(t); }

check('改造五a1：annualBracket(0) → 第 1 档 3%，lower=0 / upper=36000',
  brk(0).level === 1 && brk(0).rate === 0.03 && brk(0).quick === 0 && brk(0).lower === 0 && brk(0).upper === 36000,
  JSON.stringify(brk(0)));
check('改造五a2：annualBracket(-5000) → 第 1 档（负数归第 1 档）',
  brk(-5000).level === 1 && brk(-5000).rate === 0.03, JSON.stringify(brk(-5000)));
check('改造五a3：annualBracket(36000) → 第 1 档（边界含入较低档）',
  brk(36000).level === 1 && brk(36000).upper === 36000, JSON.stringify(brk(36000)));
check('改造五a4：annualBracket(36001) → 第 2 档 10%，lower=36000 / upper=144000',
  brk(36001).level === 2 && brk(36001).rate === 0.10 && brk(36001).quick === 2520 && brk(36001).lower === 36000 && brk(36001).upper === 144000,
  JSON.stringify(brk(36001)));
check('改造五a5：annualBracket(144000) → 第 2 档', brk(144000).level === 2, JSON.stringify(brk(144000)));
check('改造五a6：annualBracket(144001) → 第 3 档 20%，lower=144000',
  brk(144001).level === 3 && brk(144001).rate === 0.20 && brk(144001).lower === 144000 && brk(144001).upper === 300000,
  JSON.stringify(brk(144001)));
check('改造五a7：annualBracket(300000) → 第 3 档', brk(300000).level === 3, JSON.stringify(brk(300000)));
check('改造五a8：annualBracket(300001) → 第 4 档 25%', brk(300001).level === 4 && brk(300001).rate === 0.25, JSON.stringify(brk(300001)));
check('改造五a9：annualBracket(660000) → 第 5 档 / 660001 → 第 6 档',
  brk(660000).level === 5 && brk(660001).level === 6, JSON.stringify(brk(660000)) + ' / ' + JSON.stringify(brk(660001)));
check('改造五a10：annualBracket(960000) → 第 6 档 / 960001 → 第 7 档 45%，upper=Infinity',
  brk(960000).level === 6 && brk(960001).level === 7 && brk(960001).rate === 0.45 && brk(960001).quick === 181920 && brk(960001).upper === Infinity && brk(960001).lower === 960000,
  JSON.stringify(brk(960001)));

/* ============ 改造五：marginalTax 加班边际个税 ============ */
var mo0 = TaxCalc.marginalTax(100000, 0);
check('改造五b1：加班费 0 → addedTax/netOfAdded=0、actualRate=0、不升档',
  mo0.addedTax === 0 && mo0.netOfAdded === 0 && mo0.actualRate === 0 && mo0.crossed === false,
  JSON.stringify(mo0));
var mo1 = TaxCalc.marginalTax(0, 36000);
check('改造五b2：0→36000 全程第 1 档：多缴 1080、实际税率 3%、净得 34920',
  closeTo(mo1.addedTax, 1080) && closeTo(mo1.actualRate, 0.03) && closeTo(mo1.netOfAdded, 34920) && mo1.fromLevel === 1 && mo1.toLevel === 1 && mo1.crossed === false,
  JSON.stringify(mo1));
var mo2 = TaxCalc.marginalTax(35900, 200);
check('改造五b3：35900+200 跨 36000 边界 → 第 1 档 → 第 2 档（crossed）',
  mo2.crossed === true && mo2.fromLevel === 1 && mo2.toLevel === 2, JSON.stringify(mo2));
check('改造五b4：35900+200 仅越界 100 元按 10%：多缴 13、实际税负 6.5%、净得 187',
  closeTo(mo2.addedTax, 13) && closeTo(mo2.actualRate, 0.065) && closeTo(mo2.netOfAdded, 187),
  JSON.stringify(mo2));
var mo3 = TaxCalc.marginalTax(300000, 1);
check('改造五b5：300000+1 跨 3→4 档：多缴 0.25（越界 1 元按 25% 与速算扣除差量）',
  closeTo(mo3.addedTax, 0.25) && mo3.crossed === true && mo3.fromLevel === 3 && mo3.toLevel === 4,
  JSON.stringify(mo3));
var moNeg = TaxCalc.marginalTax(-5000, 10000);
check('改造五b6：负应纳税所得额 -5000 + 10000 → 从第 1 档起算，多缴 150',
  closeTo(moNeg.addedTax, 150) && moNeg.fromLevel === 1 && moNeg.toLevel === 1 && moNeg.crossed === false,
  JSON.stringify(moNeg));
var mo4 = TaxCalc.marginalTax(100000, 50000);
check('改造五b7：100000+50000=150000 → 第 2 → 第 3 档，多缴 5600、实际税负 11.2%',
  closeTo(mo4.addedTax, 5600) && closeTo(mo4.actualRate, 0.112) && mo4.fromLevel === 2 && mo4.toLevel === 3 && mo4.crossed === true,
  JSON.stringify(mo4));

/* ============ 汇总 ============ */
console.log('');
console.log('共 ' + (passed + failed) + ' 项断言：PASS ' + passed + ' 项，FAIL ' + failed + ' 项');
if (failed === 0) {
  console.log('✅ 全部通过');
  process.exit(0);
} else {
  console.log('❌ 存在失败项');
  process.exit(1);
}
