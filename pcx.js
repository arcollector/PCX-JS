/**
*	UTILS
*/
var openFile = function( filename, callback ) {
	var xhr = new XMLHttpRequest();
	xhr.open( 'GET', filename );
	xhr.responseType = 'arraybuffer';
	xhr.onerror = function( e ) {
		console.error( 'fail to open file', filename );
	};
	xhr.onload = function( e ) {
		var res = this.response;
		if( !res ) {
			console.error( 'file is corrupted' );
			return;
		}
		callback( new Uint8Array( res ) );
	};
	xhr.send();
};

var getInt = function( arrayBuffer, index ) {
	return (arrayBuffer[index+1]<<8) | arrayBuffer[index];
};

var pixels2Bytes = function( bitsPerPixel, pixelCount ) {
	return Math.ceil(pixelCount/(8/bitsPerPixel));
}

var downloadFile = function( arrayBuffer, filename ) {
	var blob = new Blob( [ arrayBuffer ], { type: 'application/octet-binary' } );
	var $a = document.createElement( 'a' );
	$a.setAttribute( 'download', filename.toString() + '.pcx' );
	$a.setAttribute( 'href', URL.createObjectURL( blob ) );
	$a.style.display = 'none';
	document.body.appendChild( $a );
	$a.click();
	$a.parentNode.removeChild( $a );
};

var palette2Dict = function( palette, abortOnDuplicated ) {
	var dict = {};
	for( var i = 0, j = 0, l = palette.length; i < l; j++ ) {
		var r = palette[i++];
		var g = palette[i++];
		var b = palette[i++];
		var colorIndex = r+''+g+''+b;
		if( abortOnDuplicated && colorIndex in dict ) {
			console.error( r,g,b, 'color repeated in palette, can\'t continue' );
			return null;
		}
		dict[colorIndex] = j;
	}
	return dict;
};

/**
* THE CODE
*/
var DEBUG = false;
var $g_canvas = document.querySelector( '.picture' );
var g_context = $g_canvas.getContext( '2d' );

/**
* DECODING
*/
const MANUFACTURER = 0;
const VERSION = 1;
const ENCODING = 2;
const BITS_PER_PIXEL = 3;
const XMIN = 4;
const YMIN = 6;
const XMAX = 8;
const YMAX = 10;
const HRES = 12;
const VRES = 14;
const PALETTE = 16;
const COLOR_PLANES = 65;
const BYTES_PER_LINE = 66;
const PALETTE_TYPE = 68;

const PALETTE_256_ID_OFFSET = 769;
const PALETTE_256_ID_VALUE = 12;
const PALETTE_256_START_OFFSET = 768;

const IMAGE_DATA = 128;

const PCX_MONOCHROME = 1;
const PCX_CGA_4_COLORS = 2;
const PCX_4_COLORS = 3;
const PCX_8_COLORS = 4;
const PCX_16_COLORS = 5;
const PCX_16_COLORS_NIBBLED = 6;
const PCX_256_COLORS = 7;
const PCX_24_BITS = 8;

const VERSION_MONOCHROME = 0;
const VERSION_CGA_4_COLORS = 0;
const VERSION_4_COLORS_EGA_PALETTE = 3;
const VERSION_4_COLORS_HEADER_PALETTE = 5;
const VERSION_8_COLORS_EGA_PALETTE = 3;
const VERSION_8_COLORS_HEADER_PALETTE = 5;
const VERSION_16_COLORS_EGA_PALETTE = 3;
const VERSION_16_COLORS_HEADER_PALETTE = 5;
const VERSION_256_COLORS = 5;
const VERSION_24_BITS = 5;

var EGA_DEFAULT_PALETTE = new Uint8Array( [
	0x00,0x00,0x00, // black
	0x00,0x00,0xaa, // blue
	0x00,0xaa,0x00, // green
	0x00,0xaa,0xaa, // cyan
	0xaa,0x00,0x00, // red
	0xaa,0x00,0xaa, // magenta
	0xaa,0x55,0x00, // brown
	0xaa,0xaa,0xaa, // light gray
	0x55,0x55,0x55, // gray
	0x55,0x55,0xff, // light blue
	0x55,0xff,0x55, // light green
	0x55,0xff,0xff, // light cyan
	0xff,0x55,0x55, // light red
	0xff,0x55,0xff, // light magenta
	0xff,0xff,0x55, // yellow
	0xff,0xff,0xff // white
] );

var CGA_PALETTE_ZERO_DARK = new Uint8Array( [
	0,128,0, // green
	128,0,0, // red
	128,128,0 // brown (yellow)
] );

var CGA_PALETTE_ZERO_LIGHT = new Uint8Array( [
	0,255,0, // light green
	255,0,0, // light red
	255,255,0 // yellow
] );

var CGA_PALETTE_ONE_DARK = new Uint8Array( [
	0,128,128, // cyan
	128,0,128, // magenta
	128,128,128, // gray
] );

var CGA_PALETTE_ONE_LIGHT = new Uint8Array( [
	0,255,255, // light cyan
	255,0,255, // light magenta
	255,255,255, // white
] );

var decodeHeader = function( arrayBuffer, header ) {
	if( arrayBuffer[MANUFACTURER] !== 10 ) {
		console.error( 'file is not a pcx image!' );
		return false;
	}
	header.version = arrayBuffer[VERSION];
	if( arrayBuffer[ENCODING] !== 1 ) {
		console.error( 'not supported encoding scheme' );
		return false;
	}
	header.bitsPerPixel = arrayBuffer[BITS_PER_PIXEL]; // color bits
	header.xMin = getInt( arrayBuffer, XMIN );
	header.yMin = getInt( arrayBuffer, YMIN );
	header.xMax = getInt( arrayBuffer, XMAX ) + 1;
	header.yMax = getInt( arrayBuffer, YMAX ) + 1;
	header.hRes = getInt( arrayBuffer, HRES );
	header.vRes = getInt( arrayBuffer, VRES );
	header.colorPlanes = arrayBuffer[COLOR_PLANES];
	header.bytesPerLineOriginal = getInt( arrayBuffer, BYTES_PER_LINE );
	header.paletteType = getInt( arrayBuffer, PALETTE_TYPE );
	
	header.width = header.xMax - header.xMin;
	header.height = header.yMax - header.yMin;
	header.bytesPerLine = pixels2Bytes( header.bitsPerPixel, header.width );
	
	if( header.bitsPerPixel === 1 && header.colorPlanes === 1 ) {
		header.interpretation = PCX_MONOCHROME;
		
	} else if( header.bitsPerPixel === 2 && header.colorPlanes === 1 ) {
		header.interpretation = PCX_CGA_4_COLORS;
		grab16Palette( arrayBuffer, header, 4 );
		header.dict = palette2Dict( header.palette, true );
		// file palette has duplicated entries
		if( !header.dict ) {
			// use cga system palette
			header.cga = {
				backgroundColor: (arrayBuffer[PALETTE] & 0xf0) >> 4,
				colorBurst: ((arrayBuffer[PALETTE+3] & 0x80) >> 7) === 0,
				paletteNumber: (arrayBuffer[PALETTE+3] & 0x40) >> 6,
				intensityFlag: ((arrayBuffer[PALETTE+3] & 0x20) >> 5) === 1,
			};
			header.palette = new Uint8Array( 12 );
			var bkg = header.cga.backgroundColor;
			header.palette[9] = EGA_DEFAULT_PALETTE[bkg*3];
			header.palette[10] = EGA_DEFAULT_PALETTE[bkg*3+1];
			header.palette[11] = EGA_DEFAULT_PALETTE[bkg*3+2];
			var paletteToCopy = header.cga.paletteNumber === 0 && !header.cga.intensityFlag ? CGA_PALETTE_ZERO_DARK : header.cga.paletteNumber === 0 && header.cga.intensityFlag ? CGA_PALETTE_ZERO_LIGHT : header.cga.paletteNumber === 1 && !header.cga.intensityFlag ? CGA_PALETTE_ONE_DARK : CGA_PALETTE_ONE_LIGHT;
			for( var i = 0, j = 0; i < 9; i++, j++ ) {
				header.palette[i] = paletteToCopy[j];
			}
			header.dict = palette2Dict( header.palette );
		} else {
			// use this field to know if the cga file has its own palette
			header.cga = null;
		}

	} else if( header.bitsPerPixel === 1 && header.colorPlanes === 2 ) {
		header.interpretation = PCX_4_COLORS;
		if( header.version === 5 ) {
			grab16Palette( arrayBuffer, header, 4 );
			header.dict = palette2Dict( header.palette );
			header.egaSystemPalette = false;
		} else {
			header.palette = EGA_DEFAULT_PALETTE;
			header.dict = palette2Dict( EGA_DEFAULT_PALETTE );
			header.egaSystemPalette = true;
		}
		
	} else if( header.bitsPerPixel === 1 && header.colorPlanes === 3 ) {
		header.interpretation = PCX_8_COLORS;
		if( header.version === 5 ) {
			grab16Palette( arrayBuffer, header, 8 );
			header.dict = palette2Dict( header.palette );
			header.egaSystemPalette = false;
		} else {
			header.palette = EGA_DEFAULT_PALETTE;
			header.dict = palette2Dict( EGA_DEFAULT_PALETTE );
			header.egaSystemPalette = true;
		}
	
	} else if( header.bitsPerPixel === 1 && header.colorPlanes === 4 ) {
		header.interpretation = PCX_16_COLORS;
		if( header.version === 5 ) {
			grab16Palette( arrayBuffer, header, 16 );
			header.dict = palette2Dict( header.palette );
			header.egaSystemPalette = false;
		} else {
			header.palette = EGA_DEFAULT_PALETTE;
			header.dict = palette2Dict( EGA_DEFAULT_PALETTE );
			header.egaSystemPalette = true;
		}
	
	} else if( header.bitsPerPixel === 4 && header.colorPlanes === 1 ) {
		header.interpretation = PCX_16_COLORS_NIBBLED;
		if( header.version === 5 ) {
			grab16Palette( arrayBuffer, header, 16 );
			header.dict = palette2Dict( header.palette );
			header.egaSystemPalette = false;
		} else {
			header.palette = EGA_DEFAULT_PALETTE;
			header.dict = palette2Dict( EGA_DEFAULT_PALETTE );
			header.egaSystemPalette = true;
		}
		
	} else if( header.bitsPerPixel === 8 && header.colorPlanes === 1 ) {
		header.interpretation = PCX_256_COLORS;
		if( arrayBuffer[arrayBuffer.length - PALETTE_256_ID_OFFSET] !== PALETTE_256_ID_VALUE ) {
			console.error( '256 palette missing id!', header );
			return false;
		}
		grab256Palette( arrayBuffer, header, 256 );
		if( header.palette.length !== PALETTE_256_START_OFFSET ) {
			console.error( '256 palette bad size!', header );
			return false;
		}
		header.dict = palette2Dict( header.palette );
	
	} else if( header.bitsPerPixel === 8 && header.colorPlanes === 3 ) {
		header.interpretation = PCX_24_BITS;
		
	} else {
		console.error( 'not supported pcx image color', header );
		return false;
	}

	header.notEven = (header.bytesPerLineOriginal - header.bytesPerLine) === 1;
	
	return true;
};

var grab16Palette = function( arrayBuffer, header, colorsCount ) {
	header.palette = new Uint8Array( 3*colorsCount );
	for( var i = 0, j = PALETTE, k = 0; i < colorsCount; i++ ) {
		header.palette[k++] = arrayBuffer[j++]; // red
		header.palette[k++] = arrayBuffer[j++]; // green
		header.palette[k++] = arrayBuffer[j++]; // blue
	}
};

var grab256Palette = function( arrayBuffer, header ) {
	header.palette = new Uint8Array( PALETTE_256_START_OFFSET );
	for( var i = 0, j = arrayBuffer.length - PALETTE_256_START_OFFSET, k = 0; i < 256; i++ ) {
		header.palette[k++] = arrayBuffer[j++]; // red
		header.palette[k++] = arrayBuffer[j++]; // green
		header.palette[k++] = arrayBuffer[j++]; // blue
	}
};

var decodeImage = function( arrayBuffer, header ) {
	
	var arrayBufferIndex = IMAGE_DATA;
	
	var bitmap = new Uint8Array( header.height*header.bytesPerLine*header.colorPlanes );
	var bitmapIndex = 0;

	for( var i = 0, l = header.height*header.colorPlanes; i < l; i++ ) {
		if( DEBUG ) { var lineOriginal = []; var lineDecoded = []; }
		for( var byteCountLine = 0; byteCountLine < header.bytesPerLineOriginal; ) {
			// get a key byte
			var ch = arrayBuffer[arrayBufferIndex++];
			DEBUG && lineOriginal.push( ch );
			// if it's a run of bytes field
			var count;
			if( (ch & 0xc0) === 0xc0 ) {
				// and off the high bits
				count = ch & 0x3f;
				// get the run byte
				ch = arrayBuffer[arrayBufferIndex++];
				DEBUG && lineOriginal.push( ch );
			// else just store it
			} else {
				count = 1;
			}
			for( var j = 0; j < count; j++ ) {
				if( header.notEven && (byteCountLine+1) === header.bytesPerLineOriginal && (j+1) === count ) { // ignore last byte
					byteCountLine++;
					break;
				}
				// a byteCountLine has been completed, but still there is more bytes to be copied
				if( (byteCountLine+1) === header.bytesPerLineOriginal && (j+1) < count ) {
					byteCountLine = 0; // start a new line
					continue; // ignore this byte
				}
				DEBUG && lineDecoded.push( ch );
				bitmap[bitmapIndex++] = ch;
				byteCountLine++;
			}
		}
		//i>=0&&i<=100&&DEBUG&&console.log(i,lineOriginal);
		//i>=0&&i<=10&&DEBUG&&console.log(i,lineDecoded,lineDecoded.length);
	}
	console.log( 'encode bitmap is', arrayBufferIndex - IMAGE_DATA, 'bytes long' );
	console.log( 'decode bitmap is', bitmapIndex, 'bytes long' );
	
	return bitmap;
};

var bitmap2Canvas = function( bitmap, header ) {
	var image = g_context.createImageData( header.width, header.height );
	var imageDataIndex = 0;
	var pixelCountPerByte = 8/header.bitsPerPixel;
	var lastPixelCount = pixelCountPerByte - (header.bytesPerLine*pixelCountPerByte - header.width);

	if( header.interpretation === PCX_MONOCHROME ) { // 1 bits per pixel | 1 plane
		var bitMask = 1;
		for( var i = 0, byteCountLine = 1; i < bitmap.length; i++ ) {
			var byteColor = bitmap[i];
			var pixelCount = byteCountLine === header.bytesPerLine ? lastPixelCount : pixelCountPerByte;
			byteCountLine = pixelCount === pixelCountPerByte ? byteCountLine + 1 : 1;
			for( var j = 0, k = 7; j < pixelCount; j++, k-- ) {
				var color = ((byteColor & (bitMask<<k)) >> k)*255;
				image.data[imageDataIndex++] = color;
				image.data[imageDataIndex++] = color;
				image.data[imageDataIndex++] = color;
				image.data[imageDataIndex++] = 255;
			}
		}
	} else if( header.interpretation === PCX_CGA_4_COLORS ) { // 2 bits per pixel | 1 plane
		var bitMask = 3;
		for( var i = 0, byteCountLine = 1; i < bitmap.length; i++ ) {
			var byteColor = bitmap[i];
			var pixelCount = byteCountLine === header.bytesPerLine ? lastPixelCount : pixelCountPerByte;
			byteCountLine = pixelCount === pixelCountPerByte ? byteCountLine + 1 : 1;
			for( var j = 0, k = 6; j < pixelCount; j++, k -= 2 ) {
				var index = ((byteColor & (bitMask<<k)) >> k)*3;
				image.data[imageDataIndex++] = header.palette[index];
				image.data[imageDataIndex++] = header.palette[index+1];
				image.data[imageDataIndex++] = header.palette[index+2];
				image.data[imageDataIndex++] = 255;
			}
		}
	} else if( header.interpretation === PCX_4_COLORS ) { // 1 bits per pixel | 2 planes
		for( var i = 0; i < bitmap.length; i+= header.bytesPerLine*2 ) {
			for( var byteCountLine = 0; byteCountLine < header.bytesPerLine; byteCountLine++ ) {
				var pixelCount = (byteCountLine+1) === header.bytesPerLine ? lastPixelCount : pixelCountPerByte;
				for( var j = 0, k = 7; j < pixelCount; j++, k-- ) {
					var byteColorPlane1 = (bitmap[i+byteCountLine] >> k) & 0x01;
					var byteColorPlane2 = (bitmap[i+byteCountLine+header.bytesPerLine] >> k) & 0x01;
					var colorNumber = ((byteColorPlane2 << 1) | (byteColorPlane1))*3;
					image.data[imageDataIndex++] = header.palette[colorNumber];
					image.data[imageDataIndex++] = header.palette[colorNumber+1];
					image.data[imageDataIndex++] = header.palette[colorNumber+2];
					image.data[imageDataIndex++] = 255;
				}
			}
		}
	} else if( header.interpretation === PCX_8_COLORS ) { // 1 bits per pixel | 3 planes
		for( var i = 0; i < bitmap.length; i+= header.bytesPerLine*3 ) {
			for( var byteCountLine = 0; byteCountLine < header.bytesPerLine; byteCountLine++ ) {
				var pixelCount = (byteCountLine+1) === header.bytesPerLine ? lastPixelCount : pixelCountPerByte;
				for( var j = 0, k = 7; j < pixelCount; j++, k-- ) {
					var byteColorPlane1 = (bitmap[i+byteCountLine] >> k) & 0x01;
					var byteColorPlane2 = (bitmap[i+byteCountLine+header.bytesPerLine] >> k) & 0x01;
					var byteColorPlane3 = (bitmap[i+byteCountLine+header.bytesPerLine*2] >> k) & 0x01;
					var colorNumber = ((byteColorPlane3 << 2) | (byteColorPlane2 << 1) | (byteColorPlane1))*3;
					image.data[imageDataIndex++] = header.palette[colorNumber];
					image.data[imageDataIndex++] = header.palette[colorNumber+1];
					image.data[imageDataIndex++] = header.palette[colorNumber+2];
					image.data[imageDataIndex++] = 255;
				}
			}
		}
	} else if( header.interpretation === PCX_16_COLORS ) { // 1 bits per pixel | 4 planes
		for( var i = 0; i < bitmap.length; i += header.bytesPerLine*4 ) {
			for( var byteCountLine = 0; byteCountLine < header.bytesPerLine; byteCountLine++ ) {
				var pixelCount = (byteCountLine+1) === header.bytesPerLine ? lastPixelCount : pixelCountPerByte;
				for( var j = 0, k = 7; j < pixelCount; j++, k-- ) {
					var byteColorPlane1 = (bitmap[i+byteCountLine] >> k) & 0x01;
					var byteColorPlane2 = (bitmap[i+byteCountLine+header.bytesPerLine] >> k) & 0x01;
					var byteColorPlane3 = (bitmap[i+byteCountLine+header.bytesPerLine*2] >> k) & 0x01;
					var byteColorPlane4 = (bitmap[i+byteCountLine+header.bytesPerLine*3] >> k) & 0x01;
					var colorNumber = ((byteColorPlane4 << 3) | (byteColorPlane3 << 2) | (byteColorPlane2 << 1) | byteColorPlane1)*3;
					image.data[imageDataIndex++] = header.palette[colorNumber];
					image.data[imageDataIndex++] = header.palette[colorNumber+1];
					image.data[imageDataIndex++] = header.palette[colorNumber+2];
					image.data[imageDataIndex++] = 255;
				}
			}
		}
	} else if( header.interpretation === PCX_16_COLORS_NIBBLED ) { // 4 bits per pixel | 1 plane
		var bitMask = 15;
		for( var i = 0, byteCountLine = 1; i < bitmap.length; i++ ) {
			var byteColor = bitmap[i];
			var pixelCount = byteCountLine === header.bytesPerLine ? lastPixelCount : pixelCountPerByte;
			byteCountLine = pixelCount === pixelCountPerByte ? byteCountLine + 1 : 1;
			for( var j = 0, k = 4; j < pixelCount; j++, k -= 4 ) {
				var index = ((byteColor & (bitMask<<k)) >> k)*3;
				image.data[imageDataIndex++] = header.palette[index];
				image.data[imageDataIndex++] = header.palette[index+1];
				image.data[imageDataIndex++] = header.palette[index+2];
				image.data[imageDataIndex++] = 255;
			}
		}
	} else if( header.interpretation === PCX_256_COLORS ) { // 8 bits per pixel | 1 plane
		for( var i = 0; i < bitmap.length; i++ ) {
			var colorNumber = bitmap[i];
			var colorIndex = colorNumber*3;
			image.data[imageDataIndex++] = header.palette[colorIndex];
			image.data[imageDataIndex++] = header.palette[colorIndex+1];
			image.data[imageDataIndex++] = header.palette[colorIndex+2];
			image.data[imageDataIndex++] = 255;
		}
	} else if( header.interpretation === PCX_24_BITS ) { // 8 bits per pixel | 3 planes
		for( var i = 0; i < bitmap.length; i += header.bytesPerLine*3 ) {
			for( var byteCountLine = 0; byteCountLine < header.bytesPerLine; byteCountLine++ ) {
				var r = bitmap[i+byteCountLine];
				var g = bitmap[i+byteCountLine+header.bytesPerLine];
				var b = bitmap[i+byteCountLine+header.bytesPerLine*2];
				image.data[imageDataIndex++] = r;
				image.data[imageDataIndex++] = g;
				image.data[imageDataIndex++] = b;
				image.data[imageDataIndex++] = 255;
			}
		}
	}

	return image;
};

var displayImage = function( image, width, height ) {
	$g_canvas.width = width;
	$g_canvas.height = height;
	g_context.putImageData( image, 0, 0 );
};

/**
* ENCODING
*/
var createHeader = function( info, version ) {
	var header = new Uint8Array( 128 );
	header[MANUFACTURER] = 10;
	header[VERSION] = version || 3;
	header[ENCODING] = 1;
	header[BITS_PER_PIXEL] = info.bitsPerPixel;
	header[XMIN] = 0;
	header[XMIN+1] = 0;
	header[YMIN] = 0;
	header[YMIN+1] = 0;
	header[XMAX] = (info.width-1) & 0xff;
	header[XMAX+1] = ((info.width-1) >> 8) & 0xff;
	header[YMAX] = (info.height-1) & 0xff;
	header[YMAX+1] = ((info.height-1) >> 8) & 0xff;
	header[HRES] = 0;
	header[HRES+1] = 0;
	header[VRES] = 0;
	header[VRES+1] = 0;
	header[COLOR_PLANES] = info.colorPlanes;

	var bytesPerLine = pixels2Bytes( info.bitsPerPixel, info.width );
	// according to the PCX standard bytesPerLine must be a even value,
	// but even or not even, this condition not impose any harm to the decoding algorithm
	// so, I omit this requirement
	
	header[BYTES_PER_LINE] = bytesPerLine & 0xff;
	header[BYTES_PER_LINE+1] = (bytesPerLine >> 8) & 0xff;
	
	if( info.cga ) {
		header[PALETTE] = info.cga.backgroundColor << 4;
		header[PALETTE+3] = ((info.cga.colorBurst?0:1)<<7)|(info.cga.paletteNumber<<6)|((info.cga.intensityFlag?1:0)<<5);
		
	} else if( info.palette && info.palette.length <= 48 ) {
		for( var i = 0, j = PALETTE, l = info.palette.length; i < l; i++, j++ ) {
			header[j] = info.palette[i];
		}
	}
	
	return header;
};

var encodeScanLine = function( scanLine, bytesPerLine, compress, compressIndex ) {
	if( DEBUG ) { lineEncoded = []; }
	for( var j = 0; j < bytesPerLine; ) {
		var count = 0;
		while( count < 62 && (j+1) < bytesPerLine && scanLine[j] === scanLine[j+1] ) {
			count++;
			j++;
		}
		if( count > 0 ) {
			compress[compressIndex++] = 0xc0 | (count+1);
			compress[compressIndex++] = scanLine[j];
			DEBUG && lineEncoded.push( 0xc0 | (count+1) ) && lineEncoded.push(  scanLine[j] );
			j++;
		} else {
			var ch = scanLine[j];
			if( (ch & 0xc0) === 0xc0 ) {
				compress[compressIndex++] = 0xc1; // 1 run length
				DEBUG && lineEncoded.push( 0xc1 );
			}
			compress[compressIndex++] = ch;
			DEBUG && lineEncoded.push( ch );
			j++;
		}
	}
	//DEBUG&&console.log(lineEncoded);
	return compressIndex;
};

var canvasEncode_Monochrome = function( image, info ) {
	
	var bytesPerLine = pixels2Bytes( 1, info.width );
	
	var compress = new Uint8Array( bytesPerLine*info.height );
	var compressIndex = 0;
	
	var imageData = image.data;
	var imageDataIndex = 0;
	
	var scanLine = new Uint8Array( bytesPerLine );
	
	var lastPixelCount = 8 - (bytesPerLine*8 - info.width);
	
	for( var i = 0; i < info.height; i++ ) {
		for( var j = 0; j < bytesPerLine; j++ ) {
			var byteColor = 0;
			var pixelCount = (j+1) === bytesPerLine ? lastPixelCount : 8;
			for( var k = 7, m = 0; m < pixelCount; k--, m++ ) {
				byteColor |= ((imageData[imageDataIndex] >> 7) << k);
				imageDataIndex += 4;
			}
			scanLine[j] = byteColor;
		}
		compressIndex = encodeScanLine( scanLine, bytesPerLine, compress, compressIndex );
	}
	console.log( 'canvas image has been compressed to', compressIndex, 'bytes' );

	return compress.subarray( 0, compressIndex );
};

var canvasEncode_CGA4Palette = function( image, info ) {

	var bytesPerLine = pixels2Bytes( 2, info.width );
	
	var compress = new Uint8Array( bytesPerLine*info.height*2 );
	var compressIndex = 0;
	
	var imageData = image.data;
	var imageDataIndex = 0;
	
	var scanLine = new Uint8Array( bytesPerLine );
	
	var lastPixelCount = 4 - (bytesPerLine*4 - info.width);
	
	for( var i = 0; i < info.height; i++ ) {
		for( var j = 0; j < bytesPerLine; j++ ) {
			var byteColor = 0;
			var pixelCount = (j+1) === bytesPerLine ? lastPixelCount : 4;
			for( var k = 6, m = 0; m < pixelCount; k -= 2, m++ ) {
				var r = imageData[imageDataIndex++];
				var g = imageData[imageDataIndex++];
				var b = imageData[imageDataIndex++];
				imageDataIndex++;
				var colorIndex = r+''+g+''+b;
				if( !(colorIndex in info.dict) ) {
					console.error( r,g,b, 'color isn\'t present at the given palette' );
					return null;
				}
				colorIndex = info.dict[colorIndex];
				byteColor |= (colorIndex << k);
			}
			scanLine[j] = byteColor;
		}
		compressIndex = encodeScanLine( scanLine, bytesPerLine, compress, compressIndex );
	}
	console.log( 'canvas image has been compressed to', compressIndex, 'bytes' );

	return compress.subarray( 0, compressIndex );
};

var canvasEncode_4Colors = function( image, info ) {

	var bytesPerLine = pixels2Bytes( 1, info.width );

	var imageData = image.data;
	var imageDataIndex = 0;
	
	var compress = new Uint8Array( bytesPerLine*info.height*2*2 );
	var compressIndex = 0;
	
	var scanLine = new Uint8Array( bytesPerLine );
	
	var lastPixelCount = 8 - (bytesPerLine*8 - info.width);
	
	for( var i = 0; i < info.height; i++ ) {
		for( var planeBitMask = 0;  planeBitMask <= 1; planeBitMask++ ) {
			var tmp = imageDataIndex;
			if( DEBUG ) { var lineDecoded = []; }
			for( var j = 0; j < bytesPerLine; j++ ) {
				var byteColor = 0;
				var pixelCount = (j+1) === bytesPerLine ? lastPixelCount : 8;
				for( var k = 7, m = 0; m < pixelCount; k--, m++ ) {
					var r = imageData[imageDataIndex++];
					var g = imageData[imageDataIndex++];
					var b = imageData[imageDataIndex++];
					imageDataIndex++;
					var colorIndex = r+''+g+''+b;
					if( !(colorIndex in info.dict) ) {
						console.error( r,g,b, 'color isn\'t present at the given palette' );
						return null;
					}
					var colorNumber = info.dict[colorIndex];
					colorNumber = (colorNumber >> planeBitMask) & 0x01;
					byteColor |= (colorNumber << k);
				}
				DEBUG && lineDecoded.push( byteColor );
				scanLine[j] = byteColor;
			}
			//DEBUG&&console.log(lineDecoded);
			imageDataIndex = tmp;
			compressIndex = encodeScanLine( scanLine, bytesPerLine, compress, compressIndex );
		}
		imageDataIndex += info.width*4;
	}
	console.log( 'canvas image has been compressed to', compressIndex, 'bytes' );

	return compress.subarray( 0, compressIndex );
};

var canvasEncode_8Colors = function( image, info ) {

	var bytesPerLine = pixels2Bytes( 1, info.width );

	var imageData = image.data;
	var imageDataIndex = 0;
	
	var compress = new Uint8Array( bytesPerLine*info.height*3*2 );
	var compressIndex = 0;
	
	var scanLine = new Uint8Array( bytesPerLine );
	
	var lastPixelCount = 8 - (bytesPerLine*8 - info.width);
	
	for( var i = 0; i < info.height; i++ ) {
		for( var planeBitMask = 0;  planeBitMask <= 2; planeBitMask++ ) {
			var tmp = imageDataIndex;
			if( DEBUG ) { var lineDecoded = []; }
			for( var j = 0; j < bytesPerLine; j++ ) {
				var byteColor = 0;
				var pixelCount = (j+1) === bytesPerLine ? lastPixelCount : 8;
				for( var k = 7, m = 0; m < pixelCount; k--, m++ ) {
					var r = imageData[imageDataIndex++];
					var g = imageData[imageDataIndex++];
					var b = imageData[imageDataIndex++];
					imageDataIndex++;
					var colorIndex = r+''+g+''+b;
					if( !(colorIndex in info.dict) ) {
						console.error( r,g,b, 'color isn\'t present at the given palette' );
						return null;
					}
					var colorNumber = info.dict[colorIndex];
					colorNumber = (colorNumber >> planeBitMask) & 0x01;
					byteColor |= (colorNumber << k);
				}
				DEBUG && lineDecoded.push( byteColor );
				scanLine[j] = byteColor;
			}
			//DEBUG&&console.log(lineDecoded);
			imageDataIndex = tmp;
			compressIndex = encodeScanLine( scanLine, bytesPerLine, compress, compressIndex );
		}
		imageDataIndex += info.width*4;
	}
	console.log( 'canvas image has been compressed to', compressIndex, 'bytes' );

	return compress.subarray( 0, compressIndex );
};

var canvasEncode_16Colors4Planes = function( image, info ) {
	
	var bytesPerLine = pixels2Bytes( 1, info.width );

	var imageData = image.data;
	var imageDataIndex = 0;
	
	var compress = new Uint8Array( bytesPerLine*info.height*4*2 );
	var compressIndex = 0;
	
	var scanLine = new Uint8Array( bytesPerLine );
	
	var lastPixelCount = 8 - (bytesPerLine*8 - info.width);
	
	for( var i = 0; i < info.height; i++ ) {
		for( var planeBitMask = 0;  planeBitMask <= 3; planeBitMask++ ) {
			var tmp = imageDataIndex;
			if( DEBUG ) { var lineDecoded = []; }
			for( var j = 0; j < bytesPerLine; j++ ) {
	 			var byteColor = 0;
				var pixelCount = (j+1) === bytesPerLine ? lastPixelCount : 8;
				for( var k = 7, m = 0; m < pixelCount; k--, m++ ) {
					var r = imageData[imageDataIndex++];
					var g = imageData[imageDataIndex++];
					var b = imageData[imageDataIndex++];
					imageDataIndex++;
					var colorIndex = r+''+g+''+b;
					if( !(colorIndex in info.dict) ) {
						console.error( r,g,b, 'color isn\'t present at the given palette' );
						return null;
					}
					var colorNumber = info.dict[colorIndex];
					colorNumber = (colorNumber >> planeBitMask) & 0x01;
					byteColor |= (colorNumber << k);
				}
				DEBUG && lineDecoded.push( byteColor );
				scanLine[j] = byteColor;
			}
			//DEBUG&&console.log(lineDecoded);
			imageDataIndex = tmp;
			compressIndex = encodeScanLine( scanLine, bytesPerLine, compress, compressIndex );
		}
		imageDataIndex += info.width*4;
	}
	console.log( 'canvas image has been compressed to', compressIndex, 'bytes' );

	return compress.subarray( 0, compressIndex );
};

var canvasEncode_16Colors1Plane = function( image, info ) {
	var bytesPerLine = pixels2Bytes( 4, info.width );

	var imageData = image.data;
	var imageDataIndex = 0;
	
	var compress = new Uint8Array( bytesPerLine*info.height*2 );
	var compressIndex = 0;
	
	var scanLine = new Uint8Array( bytesPerLine );
	
	var lastPixelCount = 2 - (bytesPerLine*2 - info.width);
	
	for( var i = 0; i < info.height; i++ ) {
		if( DEBUG ) { var lineDecoded = []; }
		for( var j = 0; j < bytesPerLine; j++ ) {
 			var byteColor = 0;
			var pixelCount = (j+1) === bytesPerLine ? lastPixelCount : 2;
			for( var k = 4, m = 0; m < pixelCount; k -= 4, m++ ) {
				var r = imageData[imageDataIndex++];
				var g = imageData[imageDataIndex++];
				var b = imageData[imageDataIndex++];
				imageDataIndex++;
				var colorIndex = r+''+g+''+b;
				if( !(colorIndex in info.dict) ) {
					console.error( r,g,b, 'color isn\'t present at the given palette' );
					return null;
				}
				var colorNumber = info.dict[colorIndex];
				byteColor |= (colorNumber << k);
			}
			scanLine[j] = byteColor;
		}
		DEBUG && lineDecoded.push( byteColor );
		compressIndex = encodeScanLine( scanLine, bytesPerLine, compress, compressIndex );
	}
	console.log( 'canvas image has been compressed to', compressIndex, 'bytes' );

	return compress.subarray( 0, compressIndex );
};

var canvasEncode_256Colors = function( image, info ) {
	
	var bytesPerLine = pixels2Bytes( 8, info.width );

	var imageData = image.data;
	var imageDataIndex = 0;
	
	var compress = new Uint8Array( bytesPerLine*info.height*2+PALETTE_256_ID_OFFSET );
	var compressIndex = 0;
	
	var scanLine = new Uint8Array( bytesPerLine );
	
	for( var i = 0; i < info.height; i++ ) {
		for( var j = 0; j < bytesPerLine; j++ ) {
			var r = imageData[imageDataIndex++];
			var g = imageData[imageDataIndex++];
			var b = imageData[imageDataIndex++];
			imageDataIndex++;
			var colorIndex = r+''+g+''+b;
			if( !(colorIndex in info.dict) ) {
				console.error( r,g,b, 'color isn\'t present at the given palette' );
				return null;
			}
			var colorNumber = info.dict[colorIndex];
			scanLine[j] = colorNumber;
		}
		compressIndex = encodeScanLine( scanLine, bytesPerLine, compress, compressIndex );
	}	
	console.log( 'canvas image has been compressed to', compressIndex, 'bytes' );

	compress[compressIndex++] = PALETTE_256_ID_VALUE;
	for( var i = 0, j = 0; i < 256; i++ ) {
		compress[compressIndex++] = info.palette[j++];
		compress[compressIndex++] = info.palette[j++];
		compress[compressIndex++] = info.palette[j++];
	}

	return compress.subarray( 0, compressIndex );
};

var canvasEncode_24bits = function( image, info ) {
	
	var bytesPerLine = pixels2Bytes( 8, info.width );

	var imageData = image.data;
	var imageDataIndex = 0;
	
	var compress = new Uint8Array( bytesPerLine*info.height*3*2 );
	var compressIndex = 0;
	
	var scanLine = new Uint8Array( bytesPerLine );
	
	for( var i = 0; i < info.height; i++ ) {
		var tmp = imageDataIndex;
		for( var plane = 1; plane <= 3; plane++ ) {
			for( var j = 0; j < bytesPerLine; j++ ) {
				var planeColor = imageData[imageDataIndex];
				imageDataIndex += 4;
				scanLine[j] = planeColor;
			}
			compressIndex = encodeScanLine( scanLine, bytesPerLine, compress, compressIndex );
			imageDataIndex = tmp + plane;
		}
		imageDataIndex = tmp + info.width*4;
	}
	console.log( 'canvas image has been compressed to', compressIndex, 'bytes' );
	
	return compress.subarray( 0, compressIndex );
};

var buildFile = function( header, data ) {
	var file = new Uint8Array( header.length + data.length );
	file.set( header, 0 );
	file.set( data, header.length );
	return file;
};

/**
*	TEST
*/
DEBUG = true;

var Test = {
	decodeHeader: function( arrayBuffer ) {
		//console.log( arrayBuffer );
		console.log( 'file size is', arrayBuffer.length, 'bytes' );
		var header = {};
		if( !decodeHeader( arrayBuffer, header ) ) {
			return;
		}
		console.log( header );
		return header;
	},
	decodeBitmap: function( arrayBuffer, header ) {
		var bitmap = decodeImage( arrayBuffer, header );
		var image = bitmap2Canvas( bitmap, header );
		return image;
	},
	downloadFile: function( header, compress, filename ) {
		var file = buildFile( header, compress );
		downloadFile( file, filename );
	},
};

var test_monochrome = function( filenameURL ) {
	openFile( filenameURL, function( arrayBuffer ) {
		// reading
		var header = Test.decodeHeader( arrayBuffer );
		if( !header ) {
			return;
		}
		var image = Test.decodeBitmap( arrayBuffer, header );
		displayImage( image, header.width, header.height );
		
		// saving
		var newHeader = createHeader( { 
			width: header.width, 
			height: header.height, 
			bitsPerPixel: 1, 
			colorPlanes: 1
		}, VERSION_MONOCHROME );
		var compress = canvasEncode_Monochrome( image, { width: header.width, height: header.height } );
		Test.downloadFile( newHeader, compress, +new Date() );
	} );
};

var test_cga4Colors = function( filenameURL ) {
	openFile( filenameURL, function( arrayBuffer ) {
		var header = Test.decodeHeader( arrayBuffer );
		if( !header ) {
			return;
		}
		var image = Test.decodeBitmap( arrayBuffer, header );
		displayImage( image, header.width, header.height );

		var newHeader = createHeader( { 
			width: header.width, 
			height: header.height, 
			bitsPerPixel: 2, 
			colorPlanes: 1,
			cga: header.cga,
			palette: header.palette, 
		}, VERSION_CGA_4_COLORS );
		var compress = canvasEncode_CGA4Palette( image, { 
			width: header.width, 
			height: header.height,
			dict: header.dict
		} );
		Test.downloadFile( newHeader, compress, +new Date() );
	} );
};

var test_4Colors = function( filenameURL ) {
	openFile( filenameURL, function( arrayBuffer ) {
		var header = Test.decodeHeader( arrayBuffer );
		if( !header ) {
			return;
		}
		var image = Test.decodeBitmap( arrayBuffer, header );
		displayImage( image, header.width, header.height );

		var newHeader = createHeader( { 
			width: header.width, 
			height: header.height, 
			bitsPerPixel: 1, 
			colorPlanes: 2,
			palette: header.palette,
		}, header.egaSystemPalette ? VERSION_8_COLORS_EGA_PALETTE : VERSION_8_COLORS_HEADER_PALETTE );
		var compress = canvasEncode_4Colors( image, { 
			width: header.width, 
			height: header.height,
			dict: header.dict
		} );
		Test.downloadFile( newHeader, compress, +new Date() );
	} );
};

var test_8Colors = function( filenameURL ) {
	openFile( filenameURL, function( arrayBuffer ) {
		var header = Test.decodeHeader( arrayBuffer );
		if( !header ) {
			return;
		}
		var image = Test.decodeBitmap( arrayBuffer, header );
		displayImage( image, header.width, header.height );

		var newHeader = createHeader( { 
			width: header.width, 
			height: header.height, 
			bitsPerPixel: 1, 
			colorPlanes: 3,
			palette: header.palette,
		}, header.egaSystemPalette ? VERSION_8_COLORS_EGA_PALETTE : VERSION_8_COLORS_HEADER_PALETTE );
		var compress = canvasEncode_8Colors( image, { 
			width: header.width, 
			height: header.height,
			dict: header.dict
		} );
		Test.downloadFile( newHeader, compress, +new Date() );
	} );
};

var test_16Colors4Planes = function( filenameURL ) {
	openFile( filenameURL, function( arrayBuffer ) {
		var header = Test.decodeHeader( arrayBuffer );
		if( !header ) {
			return;
		}
		var image = Test.decodeBitmap( arrayBuffer, header );
		displayImage( image, header.width, header.height );
		
		var newHeader = createHeader( { 
			width: header.width, 
			height: header.height, 
			bitsPerPixel: 1, 
			colorPlanes: 4,
			palette: header.palette,
		}, header.egaSystemPalette ? VERSION_16_COLORS_EGA_PALETTE : VERSION_16_COLORS_HEADER_PALETTE );
		var compress = canvasEncode_16Colors4Planes( image, { 
			width: header.width, 
			height: header.height,
			dict: header.dict
		} );
		Test.downloadFile( newHeader, compress, +new Date() );
	} );
};

var test_16Colors1Plane = function( filenameURL ) {
	openFile( filenameURL, function( arrayBuffer ) {
		var header = Test.decodeHeader( arrayBuffer );
		if( !header ) {
			return;
		}
		var image = Test.decodeBitmap( arrayBuffer, header );
		displayImage( image, header.width, header.height );

		var newHeader = createHeader( {
			width: header.width, 
			height: header.height, 
			bitsPerPixel: 4, 
			colorPlanes: 1,
			palette: header.palette,
		}, header.egaSystemPalette ? VERSION_16_COLORS_EGA_PALETTE : VERSION_16_COLORS_HEADER_PALETTE );
		var compress = canvasEncode_16Colors1Plane( image, { 
			width: header.width, 
			height: header.height,
			dict: header.dict
		} );
		Test.downloadFile( newHeader, compress, +new Date() );
	} );
};

var test_256Colors = function( filenameURL ) {
	openFile( filenameURL, function( arrayBuffer ) {
		var header = Test.decodeHeader( arrayBuffer );
		if( !header ) {
			return;
		}
		var image = Test.decodeBitmap( arrayBuffer, header );
		displayImage( image, header.width, header.height );

		var newHeader = createHeader( { 
			width: header.width, 
			height: header.height, 
			bitsPerPixel: 8, 
			colorPlanes: 1
		}, VERSION_256_COLORS );
		var compress = canvasEncode_256Colors( image, { 
			width: header.width, 
			height: header.height,
			palette: header.palette,
			dict: header.dict
		} );
		Test.downloadFile( newHeader, compress, +new Date() );
	} );
};

var test_24bits = function( filenameURL ) {
	openFile( filenameURL, function( arrayBuffer ) {
		var header = Test.decodeHeader( arrayBuffer );
		if( !header ) {
			return;
		}
		var image = Test.decodeBitmap( arrayBuffer, header );
		displayImage( image, header.width, header.height );

		var newHeader = createHeader( { 
			width: header.width, 
			height: header.height, 
			bitsPerPixel: 8, 
			colorPlanes: 3
		}, VERSION_24_BITS );
		var compress = canvasEncode_24bits( image, { 
			width: header.width, 
			height: header.height,
		} );
		Test.downloadFile( newHeader, compress, +new Date() );
	} );
};

var filenameURL = 'FACE.PCX';
var filenameURL = 'MUMMY.PCX';
var filenameURL = 'lena9.PCX';
var filenameURL = 'CGA_BW.PCX';
var filenameURL = 'GODZILLA.PCX';
var filenameURL = 'DRACULA.PCX';
//test_monochrome( filenameURL );

var filenameURL = 'CGA_RGBI.PCX';
var filenameURL = 'CGA_FSD.PCX';
var filenameURL = 'CGA_TST1.PCX';
var filenameURL = 'lena8.pcx';
//test_cga4Colors( filenameURL );

var filenameURL = 'lena7.pcx';
//test_4Colors( filenameURL );

var filenameURL = 'animals.pcx';
var filenameURL = 'lena6.pcx';
//test_8Colors( filenameURL );

var filenameURL = 'shuttle1.pcx';
var filenameURL = 'lena4.pcx';
//test_16Colors4Planes( filenameURL );

var filenameURL = 'lena3.pcx';
var filenameURL = 'lena10.pcx';
//test_16Colors1Plane( filenameURL );

var filenameURL = 'lena2.pcx';
var filenameURL = 'lena5.pcx';
var filenameURL = 'SWCP0034.PCX';
var filenameURL = 'GMARBLES.PCX';
//test_256Colors( filenameURL );

var filenameURL = 'MARBLES.PCX';
var filenameURL = 'lena.pcx';
test_24bits( filenameURL );