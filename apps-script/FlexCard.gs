/**
 * FlexCard.gs — สร้าง flex JSON สำหรับเจ้าของอนุมัติ (TASK-18)
 *
 * input: {
 *   checkinId, displayName, phone,
 *   selfieUrl, referenceSelfieUrl,
 *   checkinAt, distanceM
 * }
 * output: message object สำหรับ push (type=flex)
 */

function buildApprovalCard(args) {
  const checkinAt = formatBangkokDateTime_(args.checkinAt);
  const outOfRange = args.outOfRange === true;

  // ปรับสี header + label ตามสถานะ
  const headerBg = outOfRange ? '#e53935' : '#06c755';
  const headerLabel = outOfRange ? '⚠️ รออนุมัติ — นอกรัศมี' : 'รออนุมัติเช็คอิน';

  // แถว distance — ถ้านอกรัศมีให้แสดง "X m (เกิน Y m)" สีแดง
  const distanceText = outOfRange
    ? args.distanceM + ' m (เกินรัศมี ' + args.radiusM + ' m)'
    : args.distanceM + ' m (ในรัศมี ' + args.radiusM + ' m)';
  const distanceColor = outOfRange ? '#e53935' : '#222222';

  const bodyContents = [
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        imageBlock_('วันนี้', args.selfieUrl),
        imageBlock_('ลงทะเบียน', args.referenceSelfieUrl),
      ],
      spacing: 'sm',
    },
    { type: 'separator', margin: 'md' },
    infoRow_('ชื่อ', args.displayName),
    infoRow_('เบอร์', args.phone || '—'),
    infoRowColored_('ระยะ', distanceText, distanceColor),
  ];

  if (outOfRange) {
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      margin: 'md',
      paddingAll: '10px',
      backgroundColor: '#fde8e8',
      cornerRadius: '6px',
      contents: [{
        type: 'text',
        text: '⚠️ พาร์ทไทม์อยู่นอกพื้นที่หน้างาน — ตัดสินใจอนุมัติ/ไม่อนุมัติด้วยวิจารณญาณ',
        size: 'xs',
        color: '#8b0000',
        wrap: true,
      }],
    });
  }

  return {
    type: 'flex',
    altText: (outOfRange ? '⚠️ นอกรัศมี — ' : '') + 'อนุมัติเช็คอิน — ' + args.displayName,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: headerLabel,
            color: '#ffffff',
            weight: 'bold',
            size: 'lg',
          },
          {
            type: 'text',
            text: checkinAt,
            color: '#ffffff',
            size: 'sm',
            margin: 'sm',
          },
        ],
        backgroundColor: headerBg,
        paddingAll: '16px',
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

function imageBlock_(label, url) {
  return {
    type: 'box',
    layout: 'vertical',
    flex: 1,
    contents: [
      {
        type: 'text',
        text: label,
        size: 'xs',
        color: '#888888',
        align: 'center',
      },
      {
        type: 'image',
        url: url || 'https://via.placeholder.com/300x300?text=no+image',
        size: 'full',
        aspectMode: 'cover',
        aspectRatio: '1:1',
        margin: 'sm',
      },
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

function formatBangkokDateTime_(isoStr) {
  if (!isoStr) return '';
  // input อาจเป็น ISO หรือ Date
  const d = (isoStr instanceof Date) ? isoStr : new Date(isoStr);
  return Utilities.formatDate(d, 'Asia/Bangkok', 'd MMM yyyy HH:mm');
}
