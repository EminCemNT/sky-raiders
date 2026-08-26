import { SaveManager } from '../utils/SaveManager.js';

/**
 * 激励广告抽象层（P2 系统扩展 · 激励广告位预留）
 * ---------------------------------------------------------------------------
 * 红线：纯抽象接口，不引入任何外部广告 SDK / 依赖。
 * 未来接真实广告（CrazyGames / 微信广告等）只改本文件：
 *   - hasAds()       返回当前环境是否展示激励广告位
 *   - showRewardAd() 播放激励广告，完成后回调 cb(success)
 * 当前占位实现：
 *   - hasAds() 读存档 noAds（去广告纯净版开关）+ 环境标记 ADS_ENV；
 *   - showRewardAd 3s 假延时后直接 success=true（"无广告直接发奖"），
 *     模拟观看向导，方便未来接真实 SDK 只改这一个文件。
 */
const ADS_ENV = true;          // 环境标记：预留 true；未来按平台/灰度开关
const FAKE_DELAY_MS = 3000;    // 占位假延时：模拟观看向导（可调 0 立即发奖）

export const Ads = {
  /** 当前环境是否有激励广告位（存档 noAds=false 且环境标记开启） */
  hasAds() {
    if (!ADS_ENV) return false;
    const s = SaveManager.load();
    return !(s && s.noAds);
  },

  /**
   * 播放激励广告；结束后回调 success=true/false。
   * 占位实现：3s 假延时后直接 success=true（"无广告直接发奖"）。
   * @param {(success: boolean) => void} callback
   */
  showRewardAd(callback) {
    const done = (ok) => { if (typeof callback === 'function') callback(ok); };
    if (!this.hasAds()) { done(false); return; }
    setTimeout(() => done(true), FAKE_DELAY_MS);
  },
};

// 测试钩子（与 main.js 的 __SAVE / __SKY 同性质，不影响玩法）
if (typeof window !== 'undefined') window.__ADS = Ads;
