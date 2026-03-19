#!/bin/bash
# Generate placeholder icons using ImageMagick (if available) or Python
# Run: bash generate-icons.sh

for size in 16 32 48 128; do
  if command -v convert &> /dev/null; then
    convert -size ${size}x${size} xc:'#DB534B' \
      -gravity center -fill white -pointsize $((size/2)) \
      -annotate +0+0 "MB" \
      "icon-${size}.png"
  elif command -v python3 &> /dev/null; then
    python3 -c "
from PIL import Image, ImageDraw
img = Image.new('RGB', ($size, $size), '#DB534B')
img.save('icon-${size}.png')
" 2>/dev/null || echo "Install Pillow: pip3 install Pillow"
  else
    echo "Install ImageMagick or Python Pillow to generate icons"
    echo "Or create ${size}x${size} PNG icons manually"
  fi
done

echo "Icons generated!"
