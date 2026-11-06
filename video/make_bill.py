from PIL import Image, ImageDraw, ImageFont
W,H=720,960
im=Image.new('RGB',(W,H),'#fbf8f1'); d=ImageDraw.Draw(im)
F=lambda s: ImageFont.truetype('/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',s)
d.rectangle([0,0,W,120],fill='#2f6f5e')
d.text((40,28),'电费缴费通知单',font=F(44),fill='white')
d.text((42,84),'示例账单 · 仅用于产品演示',font=F(20),fill='#cfe8df')
y=160
for k,v in [('户名','张**'),('户号','0000-1234（示例）'),('用电地址','幸福小区 3 栋 502'),('计费周期','2026-10-01 至 2026-10-31')]:
    d.text((40,y),k,font=F(24),fill='#777'); d.text((220,y),v,font=F(24),fill='#222'); y+=48
y+=20; d.line([40,y,W-40,y],fill='#ccc',width=2); y+=24
d.text((40,y),'时段',font=F(22),fill='#777'); d.text((220,y),'电量(kWh)',font=F(22),fill='#777'); d.text((400,y),'单价(元)',font=F(22),fill='#777'); d.text((560,y),'金额(元)',font=F(22),fill='#777'); y+=48
for a,b,c,e in [('峰段 08-22','248','0.568','140.86'),('谷段 22-08','204','0.288','58.75')]:
    for x,t in zip([40,220,400,560],[a,b,c,e]): d.text((x,y),t,font=F(28),fill='#222')
    y+=56
d.line([40,y,W-40,y],fill='#ccc',width=2); y+=30
d.text((40,y),'本期电量',font=F(28),fill='#222'); d.text((400,y),'452 kWh',font=F(32),fill='#222'); y+=64
d.text((40,y),'应缴电费',font=F(28),fill='#222'); d.text((400,y),'¥ 199.62',font=F(44),fill='#d0452f'); y+=90
d.rounded_rectangle([40,y,W-40,y+150],16,fill='#eef5f2')
d.text((64,y+22),'近6个月用电(kWh)',font=F(20),fill='#2f6f5e')
vals=[330,398,520,546,484,452]
for i,v in enumerate(vals):
    x=90+i*95; h=int(v/546*80); d.rectangle([x,y+130-h,x+40,y+130],fill='#2f6f5e' if i==5 else '#9cc7b8'); d.text((x,y+132-h-24),str(v),font=F(16),fill='#555')
d.text((40,H-60),'温馨提示：错峰用电，更省钱更环保。',font=F(20),fill='#999')
im.save('public/assets/sample-bill.png')
