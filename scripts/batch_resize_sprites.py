"""
batch_resize_sprites.py
把 AI 生成的 1024x1024 原始 PNG → 裁掉右下角水印区 → 缩放到游戏目标尺寸 → 输出到 public/sprites/
"""
import os, glob
from PIL import Image

RAW_DIR = r'C:\Users\admin\WorkBuddy\2026-06-04-21-55-44\sky-raiders\assets_raw'
OUT_DIR = r'C:\Users\admin\WorkBuddy\2026-06-04-21-55-44\sky-raiders\public\sprites'

# 文件名前缀 → 游戏贴图 key（对应 PreloadScene 的 texture key）
PREFIX_MAP = {
    'Top_down_view_of_a_sleek': 'player',
    'Top_down_view_of_a_small_aggre': 'enemy_small',
    'Top_down_view_of_a_medium_ambe': 'enemy_mid',
    'Top_down_view_of_a_giant_hexag': 'boss',
    'A_shiny_gold_coin': 'coin',
    'A_blue_cyan_round_shield': 'item_shield',
    'A_red_and_white_horseshoe': 'item_magnet',
    'A_green_small_fighter': 'item_wingman',
    'A_purple_glowing_energy': 'item_energy',
    'A_red_cross_medical': 'item_heal',
    'A_black_round_bomb': 'item_bomb',
}

# key → 目标像素尺寸（与程序化 generateTexture 的尺寸一致，逻辑零改动）
SIZE_MAP = {
    'player':      (40, 52),
    'enemy_small': (32, 30),
    'enemy_mid':   (48, 44),
    'boss':        (160, 140),
    'coin':        (22, 22),
    'item_shield': (26, 26),
    'item_magnet': (26, 26),
    'item_wingman':(26, 26),
    'item_energy': (26, 26),
    'item_heal':   (26, 26),
    'item_bomb':   (26, 26),
}

os.makedirs(OUT_DIR, exist_ok=True)
found = set()

for png in glob.glob(os.path.join(RAW_DIR, '**', '*.png'), recursive=True):
    fname = os.path.basename(png)
    key = None
    for prefix, k in PREFIX_MAP.items():
        if fname.startswith(prefix):
            key = k
            break
    if not key:
        print(f'  [SKIP] 无法识别: {fname}')
        continue

    if key in found:
        print(f'  [DUP]  已处理过 {key}, 跳过: {fname}')
        continue

    img = Image.open(png).convert('RGBA')
    w, h = img.size

    # 裁掉右下角水印区域（约底部 6% + 右侧 10%，水印在角落）
    img = img.crop((0, 0, int(w * 0.90), int(h * 0.94)))

    # LANCZOS 高质量缩放到目标尺寸
    target = SIZE_MAP[key]
    img = img.resize(target, Image.LANCZOS)

    out_path = os.path.join(OUT_DIR, f'{key}.png')
    img.save(out_path, 'PNG')
    found.add(key)
    print(f'  OK {key:12s} ({target[0]}x{target[1]}) <- {fname}')

print(f'\n共处理 {len(found)}/{len(SIZE_MAP)} 张')
if len(found) < len(SIZE_MAP):
    missing = set(SIZE_MAP.keys()) - found
    print(f'缺失: {missing}')
