import { CONFIG } from './config.js';

export const state = {
  lineUserId: null,
  profile: null, // { userId, displayName, pictureUrl }
};

/** init LIFF + getProfile */
export async function initAuth(liffId) {
  if (CONFIG.DEV_MOCK_LIFF) {
    state.lineUserId = CONFIG.DEV_MOCK_USER_ID;
    state.profile = { userId: state.lineUserId, displayName: '(dev mock)', pictureUrl: '' };
    return;
  }
  if (typeof liff === 'undefined') throw new Error('LIFF SDK ไม่โหลด');
  await liff.init({ liffId });
  if (!liff.isLoggedIn()) {
    liff.login();
    return; // จะ redirect แล้วโหลดใหม่
  }
  state.profile = await liff.getProfile();
  state.lineUserId = state.profile.userId;
}
