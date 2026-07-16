const ci = require('miniprogram-ci');

(async () => {
  // 1. 初始化项目对象
  const project = new ci.Project({
    appid: 'wxd19a1403c4fea89d',             // 从微信公众平台获取
    type: 'miniProgram',
    projectPath: './src/mini/nano-miniapp/', // 小程序项目根目录
    privateKeyPath: './miniprogram-upload-private-aeviva.key', // 上传密钥文件的路径
    ignores: ['node_modules/**/*'],         // 忽略不需要的文件
  });

  // 2. 执行上传操作
  const uploadResult = await ci.upload({
    project,
    version: '1.1.16',     // 版本号，请根据实际情况更新
    desc: '这是通过CI上传的版本',  // 版本描述
    setting: {
      es6: true,          // 启用ES6转ES5
      minify: true,       // 压缩代码
    },
    onProgressUpdate: console.log, // 打印上传进度
  });

  console.log('上传成功！', uploadResult);
})();
