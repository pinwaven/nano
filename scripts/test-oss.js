require('dotenv').config();
const OSS = require('ali-oss');

const ossClient = new OSS({
    region:          process.env.OSS_REGION || 'oss-cn-shanghai',
    accessKeyId:     process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    bucket:          process.env.OSS_BUCKET,
    secure:          true,
});

async function test() {
    try {
        console.log('Bucket:', process.env.OSS_BUCKET);
        console.log('Region:', process.env.OSS_REGION || 'oss-cn-shanghai');
        console.log('AccessKeyId Length:', (process.env.OSS_ACCESS_KEY_ID || '').length);
        
        const result = await ossClient.list({ 'max-keys': 1 });
        console.log('OSS Connection Success:', result.res.status === 200);
    } catch (err) {
        console.error('OSS Connection Failed:', err.message);
    }
}

test();
