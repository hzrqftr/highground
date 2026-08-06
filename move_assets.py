import os, shutil
root = r"C:\Users\Hazriq Fitri\github\highground"
assets_images = os.path.join(root, 'assets', 'images')
assets_icons = os.path.join(root, 'assets', 'icons')
os.makedirs(assets_images, exist_ok=True)
os.makedirs(assets_icons, exist_ok=True)

images = ['bg1-bnw.png','bg1.png','dota2_social.jpg','muerta-thumbnail-crop.jpg','muerta-thumbnail.jpg']
icons = ['hg-blue.png','highground.svg']

moved = []
for f in images:
    src = os.path.join(root, 'images', f)
    dst = os.path.join(assets_images, f)
    if os.path.exists(src):
        shutil.move(src, dst)
        moved.append(dst)

for f in icons:
    src = os.path.join(root, 'images', f)
    dst = os.path.join(assets_icons, f)
    if os.path.exists(src):
        shutil.move(src, dst)
        moved.append(dst)

print('Moved:', moved)
