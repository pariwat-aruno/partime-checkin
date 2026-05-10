/**
 * FlexCard.gs — flex JSON สำหรับเจ้าของ (cherry red minimal — บริษัท วอร์ด้า สกินแคร์ จำกัด)
 *
 * cards 3 ตัว:
 *   - buildApprovalCard       (สแกนครบ 4 → ปุ่ม approve/reject)
 *   - buildScanProgressCard   (slot 1-3 → progress only ไม่มีปุ่ม)
 *   - buildRegistrationCard   (พาร์ทไทม์ลงทะเบียนใหม่ → informational)
 */

const BRAND = 'บริษัท วอร์ด้า สกินแคร์ จำกัด';
const LOGO_URL = 'https://pariwat-aruno.github.io/partime-checkin/img/logo.jpg';
const CHERRY      = '#c8102e';
const CHERRY_DARK = '#9a0c24';
const TEXT        = '#111827';
const MUTED       = '#6b7280';
const WARNING     = '#d97706';
const REJECT      = '#374151';

function buildApprovalCard(args) {
  const dateText = formatBangkokDateOnly_(args.date);
  const hasOutOfRange = args.hasOutOfRange === true;
  const scanCount = args.scanCount || (args.slots || []).filter(function (s) { return s.completed; }).length;
  const incomplete = scanCount < 4;

  let headerLabel = 'รออนุมัติ — สแกนครบ ' + scanCount + '/4';
  let headerBg = CHERRY;
  if (incomplete && hasOutOfRange) {
    headerBg = CHERRY_DARK;
    headerLabel = 'รออนุมัติ — สแกน ' + scanCount + '/4 + นอกรัศมี';
  } else if (incomplete) {
    headerBg = WARNING;
    headerLabel = 'รออนุมัติ — สแกนไม่ครบ ' + scanCount + '/4';
  } else if (hasOutOfRange) {
    headerBg = CHERRY_DARK;
    headerLabel = 'รออนุมัติ — สแกนครบแต่นอกรัศมี';
  }

  // 4 รูป 2x2 grid
  const slotImages = [
    {
      type: 'box', layout: 'horizontal', spacing: 'sm',
      contents: [
        slotImageBlock_(args.slots && args.slots[0]),
        slotImageBlock_(args.slots && args.slots[1]),
      ],
    },
    {
      type: 'box', layout: 'horizontal', spacing: 'sm', margin: 'sm',
      contents: [
        slotImageBlock_(args.slots && args.slots[2]),
        slotImageBlock_(args.slots && args.slots[3]),
      ],
    },
  ];

  const distanceText = hasOutOfRange
    ? args.lastDistanceM + ' m (นอกรัศมี ' + args.radiusM + ' m)'
    : args.lastDistanceM + ' m';
  const distanceColor = hasOutOfRange ? CHERRY_DARK : TEXT;

  const bodyContents = slotImages.concat([
    { type: 'separator', margin: 'md' },
    infoRow_('ชื่อ', args.displayName),
    infoRow_('วัน', dateText),
    infoRow_('สแกน', scanCount + '/4'),
    infoRowColored_('ระยะล่าสุด', distanceText, distanceColor),
  ]);

  if (incomplete) {
    bodyContents.push({
      type: 'box', layout: 'vertical', margin: 'md',
      paddingAll: '10px', backgroundColor: '#fef3c7', cornerRadius: '6px',
      contents: [{
        type: 'text', text: 'สแกนหน้าไม่ครบ 4 ครั้ง ตรวจสอบก่อนอนุมัติ',
        size: 'xs', color: WARNING, wrap: true,
      }],
    });
  }
  if (hasOutOfRange) {
    bodyContents.push({
      type: 'box', layout: 'vertical', margin: 'sm',
      paddingAll: '10px', backgroundColor: '#fef2f2', cornerRadius: '6px',
      contents: [{
        type: 'text', text: 'มีบาง slot อยู่นอกพื้นที่หน้างาน',
        size: 'xs', color: CHERRY_DARK, wrap: true,
      }],
    });
  }

  return {
    type: 'flex',
    altText: BRAND + ' — ' + headerLabel + ' — ' + args.displayName,
    contents: {
      type: 'bubble', size: 'mega',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: headerBg, paddingAll: '14px',
        contents: [
          {
            type: 'box', layout: 'horizontal', spacing: 'sm',
            contents: [
              { type: 'image', url: LOGO_URL, size: 'xxs', flex: 0, aspectMode: 'cover', aspectRatio: '1:1' },
              { type: 'text', text: BRAND, color: '#ffffff', size: 'xxs', weight: 'bold', gravity: 'center', flex: 1 },
            ],
          },
          { type: 'text', text: headerLabel, color: '#ffffff', weight: 'bold', size: 'lg', wrap: true, margin: 'md' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', contents: bodyContents,
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          {
            type: 'box', layout: 'horizontal', spacing: 'sm',
            contents: [
              actionButton_('เต็มวัน 400', 'action=approve&id=' + args.checkinId + '&type=full', CHERRY),
              actionButton_('ครึ่งวัน 200', 'action=approve&id=' + args.checkinId + '&type=half', CHERRY_DARK),
            ],
          },
          actionButton_('ไม่อนุมัติ', 'action=reject&id=' + args.checkinId, REJECT),
        ],
      },
    },
  };
}

function buildScanProgressCard(args) {
  const time = formatBangkokTimeOnly_(args.at);
  const headerBg = args.outOfRange ? CHERRY_DARK : CHERRY;
  const tag = args.outOfRange ? 'นอกรัศมี ' : '';
  const headerLabel = tag + 'สแกน ' + args.slotLabel + ' (' + args.scanCount + '/4)';
  const distanceText = args.outOfRange
    ? args.distanceM + ' m (นอกรัศมี ' + args.radiusM + ' m)'
    : args.distanceM + ' m';
  const distanceColor = args.outOfRange ? CHERRY_DARK : TEXT;

  return {
    type: 'flex',
    altText: BRAND + ' — ' + headerLabel + ' — ' + args.displayName,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: headerBg, paddingAll: '12px',
        contents: [
          {
            type: 'box', layout: 'horizontal', spacing: 'sm',
            contents: [
              { type: 'image', url: LOGO_URL, size: 'xxs', flex: 0, aspectMode: 'cover', aspectRatio: '1:1' },
              { type: 'text', text: BRAND, color: '#ffffff', size: 'xxs', weight: 'bold', gravity: 'center', flex: 1 },
            ],
          },
          { type: 'text', text: headerLabel, color: '#ffffff', weight: 'bold', size: 'md', wrap: true, margin: 'md' },
          { type: 'text', text: time + '  •  ' + args.displayName, color: '#ffffff', size: 'xs', margin: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          {
            type: 'image',
            url: driveUrlToThumbnail_(args.selfieUrl) || 'https://via.placeholder.com/300x300',
            size: 'full', aspectMode: 'cover', aspectRatio: '1:1',
          },
          { type: 'separator', margin: 'sm' },
          infoRow_('พนักงาน', args.employeeId + ' — ' + args.displayName),
          infoRowColored_('ระยะ', distanceText, distanceColor),
          infoRow_('สแกนแล้ว', args.scanCount + '/4'),
        ],
      },
    },
  };
}

function buildRegistrationCard(args) {
  return {
    type: 'flex',
    altText: BRAND + ' — พาร์ทไทม์ใหม่: ' + args.displayName,
    contents: {
      type: 'bubble', size: 'mega',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: CHERRY, paddingAll: '14px',
        contents: [
          {
            type: 'box', layout: 'horizontal', spacing: 'sm',
            contents: [
              { type: 'image', url: LOGO_URL, size: 'xxs', flex: 0, aspectMode: 'cover', aspectRatio: '1:1' },
              { type: 'text', text: BRAND, color: '#ffffff', size: 'xxs', weight: 'bold', gravity: 'center', flex: 1 },
            ],
          },
          { type: 'text', text: 'พาร์ทไทม์ลงทะเบียนใหม่', color: '#ffffff', weight: 'bold', size: 'lg', margin: 'md' },
          { type: 'text', text: args.employeeId, color: '#ffffff', size: 'sm', margin: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          {
            type: 'box', layout: 'horizontal', spacing: 'sm',
            contents: [
              imageBlockSimple_('selfie', args.selfieUrl),
              imageBlockSimple_('บัตร ปชช.', args.idCardUrl),
            ],
          },
          { type: 'separator', margin: 'md' },
          infoRow_('ชื่อ', args.displayName),
          infoRow_('เบอร์', args.phone || '—'),
          infoRow_('ธนาคาร', args.bankName || '—'),
          infoRow_('เลขบัญชี', args.bankAccountNo || '—'),
          infoRow_('ชื่อบัญชี', args.bankAccountName || '—'),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'text', size: 'xs', color: MUTED, wrap: true, align: 'center',
          text: 'ตรวจสอบในระบบ — ระงับด้วย is_active=FALSE ใน Sheet ถ้าไม่ผ่าน',
        }],
      },
    },
  };
}

function slotImageBlock_(slot) {
  if (!slot) return placeholderBlock_('—');
  if (!slot.completed) {
    return {
      type: 'box', layout: 'vertical', flex: 1,
      contents: [
        { type: 'text', text: slot.label, size: 'xxs', color: MUTED, align: 'center' },
        {
          type: 'box', layout: 'vertical', height: '120px',
          backgroundColor: '#f3f4f6', cornerRadius: '6px', margin: 'sm',
          justifyContent: 'center',
          contents: [{
            type: 'text', text: 'ไม่ได้สแกน',
            size: 'xxs', color: MUTED, align: 'center', wrap: true,
          }],
        },
      ],
    };
  }
  const timeStr = formatBangkokTimeOnly_(slot.at);
  return {
    type: 'box', layout: 'vertical', flex: 1,
    contents: [
      { type: 'text', text: slot.label + ' ' + timeStr, size: 'xxs', color: MUTED, align: 'center', wrap: true },
      {
        type: 'image',
        url: driveUrlToThumbnail_(slot.url) || 'https://via.placeholder.com/300x300',
        size: 'full', aspectMode: 'cover', aspectRatio: '1:1', margin: 'sm',
      },
    ],
  };
}

function imageBlockSimple_(label, url) {
  return {
    type: 'box', layout: 'vertical', flex: 1,
    contents: [
      { type: 'text', text: label, size: 'xxs', color: MUTED, align: 'center' },
      {
        type: 'image',
        url: driveUrlToThumbnail_(url) || 'https://via.placeholder.com/300x300',
        size: 'full', aspectMode: 'cover', aspectRatio: '1:1', margin: 'sm',
      },
    ],
  };
}

function placeholderBlock_(label) {
  return {
    type: 'box', layout: 'vertical', flex: 1,
    contents: [{ type: 'text', text: label, size: 'xxs', color: MUTED, align: 'center' }],
  };
}

function infoRow_(label, value) {
  return infoRowColored_(label, value, TEXT);
}

function infoRowColored_(label, value, color) {
  return {
    type: 'box', layout: 'horizontal',
    contents: [
      { type: 'text', text: label, size: 'sm', color: MUTED, flex: 2 },
      { type: 'text', text: String(value), size: 'sm', color: color, flex: 5, wrap: true, weight: 'bold' },
    ],
  };
}

function actionButton_(label, postbackData, color) {
  return {
    type: 'button', style: 'primary', color: color, height: 'sm',
    action: { type: 'postback', label: label, data: postbackData, displayText: label },
  };
}

function driveUrlToThumbnail_(url) {
  if (!url) return '';
  const m = String(url).match(/\/file\/d\/([^\/\?]+)/);
  if (!m) return url;
  return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w800';
}

function formatBangkokDateOnly_(d) {
  if (!d) return '';
  const dt = (d instanceof Date) ? d : new Date(d);
  return Utilities.formatDate(dt, 'Asia/Bangkok', 'd MMM yyyy');
}

function formatBangkokTimeOnly_(d) {
  if (!d) return '';
  const dt = (d instanceof Date) ? d : new Date(d);
  return Utilities.formatDate(dt, 'Asia/Bangkok', 'HH:mm');
}
