/**
 * FlexCard.gs — สร้าง flex JSON สำหรับเจ้าของอนุมัติ (4-slot version)
 *
 * input: {
 *   checkinId, displayName, phone, date,
 *   slots: [{slot, label, at, url, completed}, ...],
 *   referenceSelfieUrl, lastDistanceM, radiusM,
 *   hasOutOfRange, scanCount
 * }
 * output: message object สำหรับ push (type=flex)
 */

function buildApprovalCard(args) {
  const dateText = formatBangkokDateOnly_(args.date);
  const hasOutOfRange = args.hasOfRange === true || args.hasOutOfRange === true;
  const scanCount = args.scanCount || (args.slots || []).filter(function (s) { return s.completed; }).length;
  const incomplete = scanCount < 4;

  // สี header
  let headerBg = '#06c755';
  let headerLabel = 'รออนุมัติ — สแกนครบ 4/4';
  if (incomplete && hasOutOfRange) {
    headerBg = '#e53935';
    headerLabel = '⚠️ สแกน ' + scanCount + '/4 + นอกรัศมี';
  } else if (incomplete) {
    headerBg = '#fbbc04';
    headerLabel = '⚠️ สแกนไม่ครบ ' + scanCount + '/4';
  } else if (hasOutOfRange) {
    headerBg = '#e53935';
    headerLabel = '⚠️ ครบ 4/4 แต่นอกรัศมี';
  }

  // 4 รูป slot จัด 2x2 grid (2 row x 2 col)
  const slotImages2x2 = [
    {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      contents: [
        slotImageBlock_(args.slots && args.slots[0]),
        slotImageBlock_(args.slots && args.slots[1]),
      ],
    },
    {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      margin: 'sm',
      contents: [
        slotImageBlock_(args.slots && args.slots[2]),
        slotImageBlock_(args.slots && args.slots[3]),
      ],
    },
  ];

  // reference selfie + ระยะ + ชื่อ
  const distanceText = hasOutOfRange
    ? args.lastDistanceM + ' m (นอกรัศมี ' + args.radiusM + ' m)'
    : args.lastDistanceM + ' m';
  const distanceColor = hasOutOfRange ? '#e53935' : '#222222';

  const bodyContents = slotImages2x2.concat([
    { type: 'separator', margin: 'md' },
    infoRow_('ชื่อ', args.displayName),
    infoRow_('วัน', dateText),
    infoRow_('สแกน', scanCount + '/4 ' + (incomplete ? '⚠️ ไม่ครบ' : '✅ ครบ')),
    infoRowColored_('ระยะล่าสุด', distanceText, distanceColor),
  ]);

  if (incomplete) {
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      margin: 'md',
      paddingAll: '10px',
      backgroundColor: '#fff3e0',
      cornerRadius: '6px',
      contents: [{
        type: 'text',
        text: '⚠️ สแกนหน้าไม่ครบ 4 ครั้ง — ตรวจสอบก่อนอนุมัติ',
        size: 'xs',
        color: '#e65100',
        wrap: true,
      }],
    });
  }
  if (hasOutOfRange) {
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      margin: 'sm',
      paddingAll: '10px',
      backgroundColor: '#fde8e8',
      cornerRadius: '6px',
      contents: [{
        type: 'text',
        text: '⚠️ มีบาง slot อยู่นอกพื้นที่หน้างาน',
        size: 'xs',
        color: '#8b0000',
        wrap: true,
      }],
    });
  }

  return {
    type: 'flex',
    altText: headerLabel + ' — ' + args.displayName,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: headerLabel, color: '#ffffff', weight: 'bold', size: 'lg', wrap: true },
        ],
        backgroundColor: headerBg,
        paddingAll: '14px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: bodyContents,
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            contents: [
              actionButton_('เต็มวัน 400', 'action=approve&id=' + args.checkinId + '&type=full', '#06c755'),
              actionButton_('ครึ่งวัน 200', 'action=approve&id=' + args.checkinId + '&type=half', '#fbbc04'),
            ],
          },
          actionButton_('ไม่อนุมัติ', 'action=reject&id=' + args.checkinId, '#e53935'),
        ],
      },
    },
  };
}

/** บล็อกรูป 1 slot — แสดง label + รูป (หรือ "ไม่ได้สแกน" ถ้า incomplete) */
function slotImageBlock_(slot) {
  if (!slot) {
    return placeholderBlock_('—');
  }
  if (!slot.completed) {
    return {
      type: 'box',
      layout: 'vertical',
      flex: 1,
      contents: [
        { type: 'text', text: slot.label, size: 'xxs', color: '#aaaaaa', align: 'center' },
        {
          type: 'box',
          layout: 'vertical',
          height: '120px',
          backgroundColor: '#f0f0f0',
          cornerRadius: '6px',
          margin: 'sm',
          justifyContent: 'center',
          contents: [{
            type: 'text', text: 'ไม่ได้สแกน', size: 'xxs', color: '#999999', align: 'center', wrap: true,
          }],
        },
      ],
    };
  }
  const timeStr = formatBangkokTimeOnly_(slot.at);
  return {
    type: 'box',
    layout: 'vertical',
    flex: 1,
    contents: [
      { type: 'text', text: slot.label + ' ' + timeStr, size: 'xxs', color: '#888888', align: 'center', wrap: true },
      {
        type: 'image',
        url: driveUrlToThumbnail_(slot.url) || 'https://via.placeholder.com/300x300?text=no+image',
        size: 'full',
        aspectMode: 'cover',
        aspectRatio: '1:1',
        margin: 'sm',
      },
    ],
  };
}

function placeholderBlock_(label) {
  return {
    type: 'box',
    layout: 'vertical',
    flex: 1,
    contents: [
      { type: 'text', text: label, size: 'xxs', color: '#aaaaaa', align: 'center' },
    ],
  };
}

function infoRow_(label, value) {
  return infoRowColored_(label, value, '#222222');
}

function infoRowColored_(label, value, color) {
  return {
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#888888', flex: 2 },
      { type: 'text', text: String(value), size: 'sm', color: color, flex: 5, wrap: true, weight: 'bold' },
    ],
  };
}

function actionButton_(label, postbackData, color) {
  return {
    type: 'button',
    style: 'primary',
    color: color,
    height: 'sm',
    action: {
      type: 'postback',
      label: label,
      data: postbackData,
      displayText: label,
    },
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
