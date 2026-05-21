/**
 * Wage.gs — เครื่องคิดเงินโมเดลใหม่ (รายชั่วโมง-นาที จากเวลาสแกน)  [P1]
 *
 * สูตร:
 *   ต่อชั่วโมง = daily_wage / 8
 *   ต่อนาที    = ต่อชั่วโมง / 60
 *   ฐานตาม day_type: full=daily_wage, half=daily_wage/2,
 *                     custom=ต่อชั่วโมง×work_hours, absent=0
 *   มาสาย (จากเวลาสแกน slot1 เทียบ work_start_time):
 *     นาทีที่หัก = max(0, นาทีสาย − late_grace_minutes)   ← หักเฉพาะส่วนเกิน grace
 *     หัก        = นาทีที่หัก × ต่อนาที                     ← ใช้กับทุก day_type ยกเว้น absent
 *   ค่าจ้างสุทธิ = max(0, ฐาน − หัก)
 *
 * ทุกฟังก์ชันเป็น pure (ไม่แตะ sheet) — เทสได้ด้วย testComputeWage_()
 */

var WORK_HOURS_PER_DAY = 8;

/** ค่าจ้าง/วัน ของพนักงานคนนี้ (รายบุคคล > default) */
function getDailyWage_(emp, cfg) {
  var raw = emp ? emp.daily_wage : null;
  var w = (raw === '' || raw == null) ? NaN : Number(raw);
  if (isNaN(w) || w <= 0) return Number(cfg.wage_default) || 400;
  return w;
}

function wagePerHour_(dailyWage) { return dailyWage / WORK_HOURS_PER_DAY; }
function wagePerMinute_(dailyWage) { return wagePerHour_(dailyWage) / 60; }

/** "HH:mm" → จำนวนนาทีจากเที่ยงคืน */
function hmToMinutes_(hm) {
  var p = String(hm).split(':');
  return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0);
}

/**
 * นาทีที่มาสาย เทียบ work_start_time
 * slot1At = ISO string (yyyy-MM-ddTHH:mm:ssXXX) จาก nowBangkok()
 * คืน 0 ถ้ามาก่อน/ตรงเวลา หรือ parse ไม่ได้
 */
function lateMinutes_(slot1At, cfg) {
  if (!slot1At) return 0;
  var scan = new Date(slot1At);
  if (isNaN(scan.getTime())) return 0;
  var hhmm = Utilities.formatDate(scan, 'Asia/Bangkok', 'HH:mm');
  var startMin = hmToMinutes_(cfg.work_start_time || '08:00');
  return Math.max(0, hmToMinutes_(hhmm) - startMin);
}

/** นาทีที่ถูกหักจริง = ส่วนเกิน grace */
function chargedLateMinutes_(lateMin, cfg) {
  var grace = Number(cfg.late_grace_minutes);
  if (isNaN(grace)) grace = 15;
  return Math.max(0, lateMin - grace);
}

/** ค่าจ้างฐานตาม day_type (ก่อนหักมาสาย) */
function baseWageForDayType_(dailyWage, dayType, workHours) {
  switch (dayType) {
    case 'full':   return dailyWage;
    case 'half':   return dailyWage / 2;
    case 'custom': return wagePerHour_(dailyWage) * (Number(workHours) || 0);
    case 'absent':
    case 'none':   return 0;
    default:       return 0;
  }
}

function wageRound2_(n) { return Math.round(n * 100) / 100; }
function wageRound4_(n) { return Math.round(n * 10000) / 10000; }

/**
 * คิดเงินรวมของ 1 วัน
 * @param {Object} emp        row พนักงาน (ใช้ field daily_wage)
 * @param {string} slot1At    เวลาสแกนรอบแรก (ISO) — ใช้คิดมาสาย
 * @param {string} dayType    'full' | 'half' | 'custom' | 'absent'
 * @param {number} workHours  ใช้เมื่อ dayType='custom'
 * @param {Object} cfg        getConfig()
 * @return {Object} { dailyWage, perHour, perMinute, base, lateMinutes,
 *                    chargedLateMinutes, deduction, net }
 */
function computeWage_(emp, slot1At, dayType, workHours, cfg) {
  var dailyWage = getDailyWage_(emp, cfg);
  var perHour = wagePerHour_(dailyWage);
  var perMinute = wagePerMinute_(dailyWage);
  var base = baseWageForDayType_(dailyWage, dayType, workHours);

  var lateMin = lateMinutes_(slot1At, cfg);
  var chargedLate = chargedLateMinutes_(lateMin, cfg);
  var isAbsent = (dayType === 'absent' || dayType === 'none');
  var deduction = isAbsent ? 0 : wageRound2_(chargedLate * perMinute);
  var net = Math.max(0, wageRound2_(base - deduction));

  return {
    dailyWage: dailyWage,
    perHour: wageRound2_(perHour),
    perMinute: wageRound4_(perMinute),
    base: wageRound2_(base),
    lateMinutes: lateMin,
    chargedLateMinutes: chargedLate,
    deduction: deduction,
    net: net,
  };
}

// ========================================================================
// เทส — กด Run บน testComputeWage_ ใน Apps Script editor (ดูผลใน Logs)
// ========================================================================
function testComputeWage() {
  var cfg = { wage_default: 400, late_grace_minutes: 15, work_start_time: '08:00' };
  var emp = { daily_wage: '' }; // ใช้ default 400

  var cases = [
    { name: 'เต็มวัน ตรงเวลา',        slot1: '2026-05-21T08:00:00+07:00', type: 'full',   hrs: 0 },
    { name: 'เต็มวัน สาย 20 (หัก 5)', slot1: '2026-05-21T08:20:00+07:00', type: 'full',   hrs: 0 },
    { name: 'เต็มวัน สาย 10 (ไม่หัก)', slot1: '2026-05-21T08:10:00+07:00', type: 'full',   hrs: 0 },
    { name: 'ครึ่งวัน ตรงเวลา',       slot1: '2026-05-21T08:00:00+07:00', type: 'half',   hrs: 0 },
    { name: 'กำหนดเอง 3 ชม',          slot1: '2026-05-21T08:00:00+07:00', type: 'custom', hrs: 3 },
    { name: 'ไม่มาทำงาน',             slot1: '2026-05-21T09:00:00+07:00', type: 'absent', hrs: 0 },
  ];

  cases.forEach(function (c) {
    var r = computeWage_(emp, c.slot1, c.type, c.hrs, cfg);
    Logger.log('%s → base=%s late=%s(หัก%s) หัก=%s net=%s [฿/นาที=%s]',
      c.name, r.base, r.lateMinutes, r.chargedLateMinutes, r.deduction, r.net, r.perMinute);
  });
  // คาดหวัง: เต็มวันสาย20 → net 395.83 (400 − 5×0.8333) ; ครึ่งวัน → 200 ; custom3 → 150
}
