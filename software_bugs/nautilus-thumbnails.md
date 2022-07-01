It's 2022 and you still have to do this...

By default Nautilus does not support generating thumbnails for RAW photos.
However, they often have embedded preview photos, which can be used as a thumbnail.
And it is fast.

1. Install [exiv2](https://exiv2.org/)

```bash
sudo apt install exiv2
```

2. In `~/.local/share/thumbnailers/exiv2.thumbnailer` file add following:

```bash
[Thumbnailer Entry]
Exec=exiv2-thumbnailer %i %o
MimeType=image/x-sony-arw;image/x-canon-cr2;
#MimeType=image/x-arw;image/x-bay;image/x-canon-cr2;image/x-canon-crw;image/x-cap;image/x-cr2;image/x-crw;image/x-dcr;image/x-dcraw;image/x-dcs;image/x-dng;image/x-drf;image/x-eip;image/x-erf;image/x-fff;image/x-fuji-raf;image/x-iiq;image/x-k25;image/x-kdc;image/x-mef;image/x-minolta-mrw;image/x-mos;image/x-mrw;image/x-nef;image/x-nikon-nef;image/x-nrw;image/x-olympus-orf;image/x-orf;image/x-panasonic-raw;image/x-panasonic-raw2;image/x-pef;image/x-pentax-pef;image/x-ptx;image/x-pxn;image/x-r3d;image/x-raf;image/x-raw;image/x-rw2;image/x-rwl;image/x-rwz;image/x-samsung-srw;image/x-sigma-x3f;image/x-sony-arw;image/x-sony-sr2;image/x-sony-srf;image/x-sr2;image/x-srf;image/x-x3f;image/x-adobe-dng;image/x-portable-pixmap;image/tiff;
```

If you want more types, use commented line instead.

3. In `/usr/bin/exiv2-thumbnailer` file add following:

```
#!/bin/bash

fullfile=$1
filename="${fullfile%.*}"

exiv2 -ep1 -f $1
convert ${filename}-preview1.jpg $2
rm ${filename}-preview1.jpg
```

**Note:** `convert` is needed because Nauilus uses `.png` for thumbnails.

Kill Nautilus with `nautilus -q` and restart it.

For more info & how to debug: [link](https://askubuntu.com/questions/1368910/how-to-create-custom-thumbnailers-for-nautilus-nemo-and-caja)
