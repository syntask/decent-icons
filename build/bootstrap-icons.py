import os
import json
import requests
import concurrent.futures
import re
import nltk
from nltk.corpus import words

# Download the words corpus if it's not already downloaded
try:
    print("Checking dependencies...")
    nltk.data.find('corpora/words')
except LookupError:
    print("Downloading NLTK words corpus...")
    nltk.download('words', quiet=True)

# Create a set of English words for faster lookup
english_words = set(w.lower() for w in words.words())

# Add more common words that might not be in the NLTK corpus
additional_common_words = {
    'app', 'apps', 'ui', 'ux', 'api', 'io', 'os', 'db', 'gui', 'nav', 'num',
    'mic', 'wifi', 'pin', 'sim', 'bio', 'geo', 'eco', 'web', 'dev', 'pro',
    'tab', 'tag', 'max', 'min', 'net', 'log', 'key', 'top', 'end', 'box',
    'day', 'new', 'old', 'big', 'low', 'far', 'win', 'sum', 'map', 'set',
    'try', 'yes', 'no', 'fee', 'car', 'bar', 'man', 'men', 'raw'
}

# Define a set of known acronyms that should always be uppercase
known_acronyms = {
    'usb', 'hdmi', 'vga', 'ram', 'rom', 'cpu', 'gpu', 'ssd', 'hdd', 'lcd', 'led',
    'url', 'uri', 'sql', 'php', 'css', 'js', 'ftp', 'ssh', 'http', 'https',
    'xml', 'json', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'mp3', 'mp4', 'avi',
    'usb', 'sd', 'hd', 'tv', '2d', '3d', 'vr', 'ar', 'ai', 'ml', 'id', 'ip',
    'faq', 'gps', 'atm', 'cd', 'dvd', 'pc', 'mac', 'qr', 'seo', 'cms',
    'ui', 'ux', 'api', 'html', 'http', 'smtp', 'dns', 'ssl', 'tls', 'cta'
}

# fetch the html contents of https://icons.getbootstrap.com
print("Fetching Bootstrap Icons metadata...")
html = requests.get('https://icons.getbootstrap.com').text

# get all lines that contain icons
print("Processing icon metadata...")
lines = [line for line in html.split('\n') if 'data-name="' in line and 'data-tags="' in line and 'data-categories="' in line]
index = []
for line in lines:
    # get the name from data-name=""
    start = line.index('data-name="') + len('data-name="')
    end = line.index('"', start)
    icon_name = line[start:end]
    # get the tags from data-tags=""
    start = line.index('data-tags="') + len('data-tags="')
    end = line.index('"', start)
    tags = line[start:end].split(' ')
    # get the categories from data-categories=""
    start = line.index('data-categories="') + len('data-categories="')
    end = line.index('"', start)
    categories = line[start:end].split(' ')
    
    # Create base friendly name by replacing - with space and capitalizing each word
    friendly_name = icon_name.replace('-', ' ').title()
    
    # Handle numbered variants by adding a space before the number
    # Find patterns like "Word2" or "Word2 Something"
    friendly_name = re.sub(r'(\w+)([2-9]|10)(\s|$)', r'\1 \2\3', friendly_name)
    
    # Split the friendly name into words
    words = friendly_name.split()
    for i, word in enumerate(words):
        # Remove any non-word characters for checking
        clean_word = re.sub(r'[^\w]', '', word)
        clean_word_lower = clean_word.lower()
        
        # Apply uppercase logic
        if clean_word_lower in known_acronyms:
            # Known acronyms are always uppercase
            words[i] = word.replace(clean_word, clean_word.upper())
        elif 1 <= len(clean_word) <= 3:
            # Short words (1-3 letters)
            if (clean_word_lower not in english_words and 
                clean_word_lower not in additional_common_words):
                # If not in dictionary, likely an acronym
                words[i] = word.replace(clean_word, clean_word.upper())
            # Otherwise keep as title case
    
    # Rejoin the words
    friendly_name = ' '.join(words)
    
    index.append({
        'name': icon_name,
        'friendly_name': friendly_name,
        'tags': tags,
        'categories': categories
    })
    
# download the icons themselves from https://raw.githubusercontent.com/twbs/icons/refs/heads/main/icons/

def download_icon(icon):
    print(f"Downloading {icon['name']}.svg ({icon['friendly_name']})")
    icon_name = icon['name']
    url = f'https://raw.githubusercontent.com/twbs/icons/refs/heads/main/icons/{icon_name}.svg'
    svg = requests.get(url).text
    with open(f'assets/bootstrap-icons/{icon_name}.svg', 'w') as f:
        f.write(svg)

with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
    executor.map(download_icon, index)

# write the index to assets/bootstrap-icons/index.json
with open('assets/bootstrap-icons/index.json', 'w') as f:
    json.dump(index, f, indent=2)
print('Wrote icons/index.json')
print('Done.')