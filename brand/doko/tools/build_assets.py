# /// script
# dependencies = ["potracer==0.0.4", "resvg-py==0.5.0", "pillow==13.0.0"]
# ///
"""Rebuild the approved logo from its saved source, without replacing its lettering."""
from pathlib import Path
from io import BytesIO
import json, shutil
from PIL import Image, ImageOps
import potrace, resvg_py
ROOT=Path(__file__).resolve().parents[1]
INK='#1A1A1A'; PAPER='#F7F5F3'; MINT='#C5E1CB'
source=Image.open(ROOT/'source/selected-concept-50.png').convert('L').crop((0,0,1536,700))
mask=source.point(lambda p:255 if p<128 else 0)
bbox=mask.getbbox(); mask=mask.crop(bbox)

def trace(mask):
    paths=[]
    for curve in potrace.Bitmap(ImageOps.invert(mask)).trace(turdsize=2,opttolerance=.15):
        p=curve.start_point; d=f'M{p.x:.3f},{p.y:.3f}'
        for s in curve:
            if s.is_corner: d+=f'L{s.c.x:.3f},{s.c.y:.3f} {s.end_point.x:.3f},{s.end_point.y:.3f}'
            else:d+=f'C{s.c1.x:.3f},{s.c1.y:.3f} {s.c2.x:.3f},{s.c2.y:.3f} {s.end_point.x:.3f},{s.end_point.y:.3f}'
        paths.append(d+'Z')
    return ''.join(paths)

def svg(w,h,path,color=INK,extra=''):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">{extra}<path fill="{color}" fill-rule="evenodd" d="{path}"/></svg>'

def render(s,w):return Image.open(BytesIO(resvg_py.svg_to_bytes(svg_string=s,width=w))).convert('RGBA')

shapes={'logo':mask,'mark':mask.crop((0,0,337,311))}
word=mask.crop((396,0,1045,311)); shapes['wordmark']=word.crop(word.getbbox())
assets={}
for name,m in shapes.items():
    path=trace(m); w,h=m.size
    for tone,color in [('ink',INK),('white','#FFFFFF')]:
        s=svg(w,h,path,color); (ROOT/f'logos/doko-{name}-{tone}.svg').write_text(s)
        render(s,2090 if name=='logo' else 1024).save(ROOT/f'logos/doko-{name}-{tone}.png')
    assets[name]={'width':w,'height':h,'path':path}
mark=assets['mark']
favicon=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#C5E1CB"/><g transform="translate(7 8.929) scale({50/337})"><path fill="{INK}" fill-rule="evenodd" d="{mark["path"]}"/></g></svg>'
(ROOT/'favicon/favicon.svg').write_text(favicon)
desktop=(ROOT/'logos/doko-app-icon.svg').read_text()
for target in ['build/icon.png','electron/icon.png']:
    render(desktop,1024).save(ROOT.parents[1]/target)
for n in [16,24,32,48,64,128,180,192,256,512,1024]:render(favicon,n).save(ROOT/f'favicon/doko-icon-{n}.png')
render(favicon,256).save(ROOT/'favicon/favicon.ico',sizes=[(n,n) for n in [16,24,32,48,64,128,256]])
shutil.copy(ROOT/'favicon/doko-icon-180.png',ROOT/'favicon/apple-touch-icon.png')
for name in ['favicon.svg','favicon.ico','apple-touch-icon.png']:shutil.copy(ROOT/f'favicon/{name}',ROOT.parents[1]/f'public/{name}')
# Compare the production vector to the selected source at its native size.
r=render((ROOT/'logos/doko-logo-ink.svg').read_text(),1045)
a=mask; b=r.getchannel('A').point(lambda v:255 if v>=128 else 0)
import numpy as np
x=np.array(a)>0;y=np.array(b)>0
iou=float((x&y).sum()/(x|y).sum());assert iou>.99,iou
assert len(list(potrace.Bitmap(ImageOps.invert(shapes['mark'])).trace()))==3
proof=Image.new('RGB',(1200,540),PAPER)
for row,src in enumerate([ImageOps.colorize(ImageOps.invert(mask),'#1A1A1A',PAPER),r]):
    src=src.copy();src.thumbnail((1045,311));src=src.resize((836,249))
    proof.paste(src,(40,row*270+10),src if src.mode=='RGBA' else None)
proof.save(ROOT/'previews/source-vector.png')
strip=Image.new('RGB',(1000,340),PAPER)
for i,n in enumerate([16,24,32,48,64,128]):
    im=Image.open(ROOT/f'favicon/doko-icon-{n}.png');strip.paste(im,(25+i*160,30),im)
    strip.paste(im,(25+i*160,195),im)
strip.save(ROOT/'previews/favicon-sizes.png')
validation={'source_crop':bbox,'vector_foreground_iou':round(iou,6),'mark_components':3,'logo_dimensions':mask.size,'icon_sizes':[16,24,32,48,64,128,180,192,256,512,1024]}
(ROOT/'validation.json').write_text(json.dumps(validation,indent=2)+'\n')
(ROOT/'brand.json').write_text(json.dumps({'name':'Doko','logo_wordmark':'doko','selected_route':50,'status':'selected','provenance':'Approved image-gen concept; deterministic vector trace','palette':{'ink':INK,'paper':PAPER,'mint':MINT},'logo_dimensions':mask.size,'mark_dimensions':shapes['mark'].size,'application_icon':{'background':MINT,'symbol':INK},'application_accent':{'fill':MINT,'foreground':INK,'light_text':'#305D40','dark_text':MINT}},indent=2)+'\n')
print(json.dumps(validation))
