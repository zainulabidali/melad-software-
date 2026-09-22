import re

file_path = r'c:\Users\ADMIN\Desktop\HTML & JS\melad_software\js\exports.js'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add SRA3 option to the select
content = content.replace(
    '<option value="a3_landscape" style="display:none;">A3 Landscape (Horizontal)</option>',
    '<option value="a3_landscape" style="display:none;">A3 Landscape (Horizontal)</option>\n                                    <option value="sra3_landscape" style="display:none;">SRA3 Landscape (Horizontal)</option>'
)

# 2. Add SRA3 display logic to all expOrientation blocks
content = content.replace(
    'if (expOrientation.options[3]) expOrientation.options[3].style.display = \'none\'; // hide A3 Landscape',
    'if (expOrientation.options[3]) expOrientation.options[3].style.display = \'none\'; // hide A3 Landscape\n                    if (expOrientation.options[4]) expOrientation.options[4].style.display = \'none\'; // hide SRA3 Landscape'
)

content = content.replace(
    'if (expOrientation.options[3]) expOrientation.options[3].style.display = \'block\'; // show A3 Landscape',
    'if (expOrientation.options[3]) expOrientation.options[3].style.display = \'block\'; // show A3 Landscape\n                    if (expOrientation.options[4]) expOrientation.options[4].style.display = \'block\'; // show SRA3 Landscape'
)

# For the one without comment:
content = content.replace(
    'if (expOrientation.options[3]) expOrientation.options[3].style.display = \'none\';\n                        }',
    'if (expOrientation.options[3]) expOrientation.options[3].style.display = \'none\';\n                            if (expOrientation.options[4]) expOrientation.options[4].style.display = \'none\';\n                        }'
)

# 3. Update the PDF generation logic for A3/SRA3
target_layout_block = '''                const isA3 = orientation === 'a3_portrait' || orientation === 'a3_landscape';
                const cols = isA3 ? 4 : 2;
                const rows = 2;
                const cardsPerPage = cols * rows;
                
                const cardWidthNum = 95; // 9.5 cm
                const cardHeightNum = 140; // 14 cm
                
                const pageWidthNum = isA3 ? 420 : 210;
                const pageHeightNum = 297;
                
                const leftOffset = isA3 ? 20 : 10;
                const topOffset = 8.5;'''

replacement_layout_block = '''                const isA3 = orientation === 'a3_portrait' || orientation === 'a3_landscape';
                const isSRA3 = orientation === 'sra3_landscape';
                const cols = isSRA3 ? 3 : (isA3 ? 4 : 2);
                const rows = isSRA3 ? 3 : 2;
                const cardsPerPage = cols * rows;
                
                const cardWidthNum = 95; // 9.5 cm
                const cardHeightNum = 140; // 14 cm
                
                const pageWidthNum = isSRA3 ? 320 : (isA3 ? 420 : 210);
                const pageHeightNum = isSRA3 ? 450 : 297;
                
                const leftOffset = isSRA3 ? 17.5 : (isA3 ? 20 : 10);
                const topOffset = isSRA3 ? 15 : 8.5;'''

content = content.replace(target_layout_block, replacement_layout_block)

# 4. Update the PDF @page style
target_style_block = '''                let printStyle = isA3 
                    ? <style>@page { size: A3 landscape; margin: 0mm; } body { margin: 0; padding: 0; background: #fff; }</style> 
                    : <style>@page { size: A4 portrait; margin: 0mm; } body { margin: 0; padding: 0; background: #fff; }</style>;'''

replacement_style_block = '''                let printStyle = isSRA3 
                    ? <style>@page { size: 320mm 450mm; margin: 0mm; } body { margin: 0; padding: 0; background: #fff; }</style> 
                    : (isA3 
                        ? <style>@page { size: A3 landscape; margin: 0mm; } body { margin: 0; padding: 0; background: #fff; }</style> 
                        : <style>@page { size: A4 portrait; margin: 0mm; } body { margin: 0; padding: 0; background: #fff; }</style>);'''

content = content.replace(target_style_block, replacement_style_block)

# Also handle potential \r\n vs \n issues for replace by doing regex
import re
target_layout_regex = re.compile(r"const isA3 = orientation === 'a3_portrait' \|\| orientation === 'a3_landscape';\s*const cols = isA3 \? 4 : 2;\s*const rows = 2;\s*const cardsPerPage = cols \* rows;\s*const cardWidthNum = 95; // 9.5 cm\s*const cardHeightNum = 140; // 14 cm\s*const pageWidthNum = isA3 \? 420 : 210;\s*const pageHeightNum = 297;\s*const leftOffset = isA3 \? 20 : 10;\s*const topOffset = 8\.5;")
content = target_layout_regex.sub(replacement_layout_block, content)

target_style_regex = re.compile(r"let printStyle = isA3\s*\?\s*<style>@page \{ size: A3 landscape; margin: 0mm; \} body \{ margin: 0; padding: 0; background: #fff; \}</style>\s*:\s*<style>@page \{ size: A4 portrait; margin: 0mm; \} body \{ margin: 0; padding: 0; background: #fff; \}</style>;")
content = target_style_regex.sub(replacement_style_block, content)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")
