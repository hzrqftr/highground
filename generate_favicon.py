from PIL import Image
import os
root = os.path.dirname(__file__)
icons_dir = os.path.join(root, 'assets', 'icons')
src = os.path.join(icons_dir, 'hg-blue.png')
dst = os.path.join(icons_dir, 'favicon.ico')
if not os.path.exists(src):
    print('Source not found:', src)
else:
    img = Image.open(src).convert('RGBA')
    sizes = [16,32,48,64]
    imgs = [img.resize((s,s), Image.LANCZOS) for s in sizes]
    imgs[0].save(dst, format='ICO', sizes=[(s,s) for s in sizes])
    print('Created', dst)
