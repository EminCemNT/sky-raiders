import Phaser from 'phaser';

/**
 * 全局事件总线（单例）
 * ---------------------------------------------------------------------------
 * GameScene 负责逻辑与战斗，UIScene 负责 HUD 叠层。两者是并行的独立场景，
 * 不能直接互相引用对象，只能通过 EventBus 通信。
 *
 * 用法：
 *   import { EventBus } from '../utils/EventBus.js';
 *   import { EVENTS } from '../config/GameConfig.js';
 *   EventBus.emit(EVENTS.SCORE_CHANGED, 1200);        // 发送方（GameScene）
 *   EventBus.on(EVENTS.SCORE_CHANGED, fn, this);      // 接收方（UIScene）
 *
 * 记得在场景 shutdown 时 EventBus.off(...) 解绑，避免场景重启后重复回调。
 */
export const EventBus = new Phaser.Events.EventEmitter();
