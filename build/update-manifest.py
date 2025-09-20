# generate a list of all files in assets/bootstrap-icons
import os


icon_dir = 'assets/bootstrap-icons'
icons = [f for f in os.listdir(icon_dir) if f.endswith('.svg')]
# merge the icons into a single string with newlines
icons_merged = '","'.join([f.replace('.svg', '') for f in icons])
json_content = f'{{ "icons": [ "{icons_merged}" ] }}'
with open('assets/bootstrap-icons/icons.json', 'w') as f:
    f.write(json_content)
print(f'Wrote {len(icons)} icons to assets/bootstrap-icons/icons.json')