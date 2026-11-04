Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
public class PersonBlur {
 public static void Run(string src,string dst) {
 using(var original=new Bitmap(src)) using(var result=new Bitmap(original)) using(var mask=new Bitmap(original.Width,original.Height)) {
 int w=original.Width,h=original.Height;
 if(w!=1199||h!=1312) throw new Exception("Unexpected dimensions");
 int[] coords={790,294,803,293,819,296,835,304,849,316,860,331,868,349,875,371,880,389,891,405,896,422,905,433,926,439,940,450,949,468,956,491,961,520,964,548,969,568,969,584,963,604,953,624,940,643,924,657,911,663,899,662,898,684,902,705,901,732,896,761,889,797,881,836,875,864,874,880,880,904,883,941,886,978,890,1013,891,1048,891,1083,889,1114,886,1124,889,1138,893,1150,892,1158,884,1166,875,1168,859,1167,849,1163,845,1154,844,1140,843,1126,827,1122,825,1093,824,1066,829,1049,836,1030,834,1018,824,997,812,975,798,953,787,931,776,909,765,886,755,863,749,841,743,819,738,797,734,776,730,753,727,729,726,705,729,680,733,652,727,644,714,636,706,626,702,615,704,601,700,588,701,575,705,563,702,555,705,537,710,517,714,495,722,475,730,456,735,445,741,432,737,423,740,408,744,397,742,386,745,373,749,361,752,343,757,325,767,310,778,301};
 Point[] pts=new Point[coords.Length/2]; for(int i=0;i<pts.Length;i++)pts[i]=new Point(coords[i*2],coords[i*2+1]);
 using(var g=Graphics.FromImage(mask)) {g.Clear(Color.Black);g.FillPolygon(Brushes.White,pts);}
 int x0=698,y0=290,bw=275,bh=882; int rad=120; double sigma=40;
 double[] kernel=new double[rad*2+1];double sum=0;for(int i=-rad;i<=rad;i++){kernel[i+rad]=Math.Exp(-i*i/(2*sigma*sigma));sum+=kernel[i+rad];}for(int i=0;i<kernel.Length;i++)kernel[i]/=sum;
 double[,,] a=new double[bh,bw,3],b=new double[bh,bw,3],c=new double[bh,bw,3];
 for(int y=0;y<bh;y++)for(int x=0;x<bw;x++){Color p=original.GetPixel(x+x0,y+y0);a[y,x,0]=p.R;a[y,x,1]=p.G;a[y,x,2]=p.B;}
 for(int y=0;y<bh;y++)for(int x=0;x<bw;x++)for(int k=-rad;k<=rad;k++){int xx=Math.Max(0,Math.Min(bw-1,x+k));for(int z=0;z<3;z++)b[y,x,z]+=a[y,xx,z]*kernel[k+rad];}
 for(int y=0;y<bh;y++)for(int x=0;x<bw;x++)for(int k=-rad;k<=rad;k++){int yy=Math.Max(0,Math.Min(bh-1,y+k));for(int z=0;z<3;z++)c[y,x,z]+=b[yy,x,z]*kernel[k+rad];}
 for(int y=0;y<bh;y++)for(int x=0;x<bw;x++){int xx=x+x0,yy=y+y0;if(mask.GetPixel(xx,yy).R==0)continue;double alpha=1;for(int dy=-3;dy<=3;dy++)for(int dx=-3;dx<=3;dx++)if(mask.GetPixel(xx+dx,yy+dy).R==0)alpha=Math.Min(alpha,Math.Sqrt(dx*dx+dy*dy)/4.0);alpha=Math.Min(1,alpha);result.SetPixel(xx,yy,Color.FromArgb((int)Math.Round(a[y,x,0]*(1-alpha)+c[y,x,0]*alpha),(int)Math.Round(a[y,x,1]*(1-alpha)+c[y,x,1]*alpha),(int)Math.Round(a[y,x,2]*(1-alpha)+c[y,x,2]*alpha)));}
 result.Save(dst,ImageFormat.Png);
 using(var check=new Bitmap(dst)){int changed=0;for(int y=0;y<h;y++)for(int x=0;x<w;x++){bool diff=original.GetPixel(x,y).ToArgb()!=check.GetPixel(x,y).ToArgb();if(diff){changed++;if(mask.GetPixel(x,y).R==0)throw new Exception("Outside-mask change");}}Console.WriteLine("Verified 1199 x 1312; changed pixels: "+changed+"; outside-mask differences: 0");}
 }
 }
}
'@
[PersonBlur]::Run('C:\Users\ghimi\Downloads\Cozy Bedroom with Curious Botanical Print.png', (Join-Path $PSScriptRoot 'Stillpoint-person-blurred.png'))
