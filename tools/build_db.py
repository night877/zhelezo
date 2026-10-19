import json,sys,os
D=sys.argv[1]; OUT=sys.argv[2]
sel=json.load(open(D+'/sel.json',encoding='utf-8'))
G={'Chest':'chest','Back':'back','Trapezius':'back','Shoulders':'shoulders','Biceps':'biceps','Triceps':'triceps','Forearms':'forearms','Abdominals':'abs','Hip Flexors':'abs','Glutes':'glutes','Quadriceps':'quads','Hamstrings':'hamstrings','Calves':'calves','Shins':'calves','Abductors':'hips','Adductors':'hips'}
EQ={'Resistance Band':'band','Superband':'band','Cable':'band','Miniband':'mini','Bodyweight':'bw','Pull Up Bar':'bar','Ab Wheel':'wheel'}
M={'Adductor Magnus':'приводящие','Anterior Deltoids':'передняя дельта','Biceps Brachii':'бицепс','Biceps Femoris':'бицепс бедра','Brachioradialis':'плечелучевая','Erector Spinae':'разгибатели спины','Gastrocnemius':'икроножная','Gluteus Maximus':'большая ягодичная','Gluteus Medius':'средняя ягодичная','Gluteus Minimus':'малая ягодичная','Iliopsoas':'подвздошно-поясничная','Lateral Deltoids':'средняя дельта','Latissimus Dorsi':'широчайшие','Obliques':'косые мышцы живота','Pectoralis Major':'большая грудная','Posterior Deltoids':'задняя дельта','Quadriceps Femoris':'квадрицепс','Rectus Abdominis':'прямая мышца живота','Soleus':'камбаловидная','Tibialis Anterior':'передняя большеберцовая','Triceps Brachii':'трицепс','Anconeus':'локтевая','Brachialis':'брахиалис','Extensor Digitorum Longus':'разгибатель пальцев','Infraspinatus':'подостная','Rectus Femoris':'прямая мышца бедра','Rhomboids':'ромбовидные','Supraspinatus':'надостная','Extensor Hallucis Longus':'разгибатель большого пальца','Flexor Carpi Radialis':'сгибатели запястья','Serratus Anterior':'передняя зубчатая','Tensor Fasciae Latae':'напрягатель широкой фасции','Teres Major':'большая круглая','Teres Minor':'малая круглая','Tibialis Posterior':'задняя большеберцовая','Transverse Abdominis':'поперечная мышца живота','Trapezius':'трапеция','Upper Trapezius':'верх трапеции'}
L={'Beginner':1,'Novice':1,'Intermediate':2,'Advanced':3,'Expert':3,'Master':3,'Grand Master':3,'Legendary':3}
CL={'Bodybuilding':'bb','Calisthenics':'cal','Plyometric':'ply','Mobility':'mob','Balance':'bal','Postural':'pos','Animal Flow':'af','Grinds':'gr','Unsorted*':'u'}
import re
ISO=re.compile(r'сведени|сгибани|разгибани|мах|подъём рук|подъём перед|разведени|кикбэк|шраги|отведени|приведени|на носк|на носок|носков|запясть|скручиван|французск|пуловер|тяга к лицу|канатом \(верхний|21|паучьи|Скотта|кроссовер|концентр',re.I)
ru={}
for line in open(D+'/ru.txt',encoding='utf-8'):
    line=line.rstrip('\n')
    if not line: continue
    parts=line.split('|'); a=parts[2]; g=parts[3] if len(parts)>3 else ''
    if a=='g': a,g='','g'
    ru[int(parts[0])]=(parts[1],a,g)
out=[];seen=set()
for i,r in enumerate(sel):
    if i not in ru: continue
    if 'Stability Ball' in (r['Primary Equipment'],r['Secondary Equipment']): continue
    n,a,gym=ru[i]
    if n in seen: continue
    seen.add(n)
    eq=EQ[r['Primary Equipment']]
    eqs=[eq]
    if r['Posture']=='Hanging' or 'Dips' in r['Exercise']:
        if 'bar' not in eqs: eqs.append('bar')
    if any(x in (r['Secondary Equipment'] or '') for x in ('Bench','Plyo Box','Slant Board','Weight Plate')): eqs.append('bench')
    if r['Primary Equipment']=='Ab Wheel': eqs=['wheel']
    mus=[M[m] for m in (r.get('Prime Mover Muscle'),r.get('Secondary Muscle'),r.get('Tertiary Muscle')) if m and m!='None' and m in M]
    out.append({'id':'d%d'%i,'n':n,'g':G[r['Target Muscle Group']],'a':a,'e':eqs,'l':L[r['Difficulty Level']],'m':mus,'v':r.get('Short YouTube Demonstration_url') or r.get('In-Depth YouTube Explanation_url') or '','en':r['Exercise'].strip(),'k':'i' if r.get('Mechanics')=='Isolation' else 'c','cl':CL.get(r.get('Primary Exercise Classification'),'u'),**({'gym':1} if gym else {})})
k=0
for line in open(D+'/custom.txt',encoding='utf-8'):
    line=line.rstrip('\n')
    if not line or line.startswith('#'): continue
    g,n,a,e,t=line.split('|'); k+=1
    out.append({'id':'c%d'%k,'n':n,'g':g,'a':'' if a=='—' else a,'e':[e],'l':1,'m':[],'t':t,'pro':1,'k':'i' if ISO.search(n) else 'c','cl':'bb'})
import collections
print(len(out),collections.Counter(o['g'] for o in out))
open(OUT,'w',encoding='utf-8').write('// База упражнений: подборка из Functional Fitness Exercise Database (Strength to Overcome, v2.9) для дома + свои упражнения на резине.\nwindow.EXERCISES='+json.dumps(out,ensure_ascii=False,separators=(',',':'))+';\n')
