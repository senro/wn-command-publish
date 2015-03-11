'use strict';
/*
 * 1.首先判断该目录有没有package.json，如果有则说明该模块是从spm平台安装的模块，
 * 如果没有则开始询问模块名，版本号，和依赖情况，模块类型（组件，css，js）生成一个默认的package.json
 * 2.如果模块类型是组件，拷贝该目录到www临时目录/wn-publish-tmp/spm_modules，同时生成一个调用该模块的
 * 页面到该目录的views里，然后在www临时目录/wn-publish-tmp/运行wn release，生成到当前目录的examples/demo/目录里
 * 3.在该目录运行spm doc，和spm publish
 * */
var exec = require('child_process').exec,
    rd = require('rd'),
    child;
var root=fis.util.realpath(process.cwd());
var rootPathInfo=fis.util.pathinfo(root);
var wwwTmpRoot=fis.project.getTempPath('www');
var fs=require('fs');
var fse = require('fs-extra');
var inquirer = require("inquirer");
var Download = require('download');
var progress = require('download-status');

exports.name = 'publish';
exports.usage = '[options]';
exports.desc = 'publish package';
exports.register = function (commander){
    commander
        .option('-c, --customUrl <url>', 'publish to custom url, eq: http://spm.yearn.cc', String, 'http://spm.yearn.cc')
        .option('-i, --inner', 'publish to inner http://spm.woniu.com', String, 'http://spm.woniu.com')
        .option('-o, --outer', 'publish to outer http://spmjs.io', String, 'http://spm.alipay.im')
        .option('-d, --doc','publish doc only', Boolean, true)
        .on('--help', function(){
            console.log('   Examples:'.blue.bold);
            console.log('');
            console.log('   $ '+'wn publish'.blue.bold+' -d');
            console.log('   $ '+'wn publish'.blue.bold+' -c http://spm.xxx.com');
            console.log('');
        })
        .action(function () {
            /*
            * 1.先执行spm install，安装该模块所需的模块
            * 2.解析出当前文件夹所有路径
            * 3.资源分析，如果该模块有html，css或者html，css，js，init.js都有，则生成demo.html到examples/,同时把所有图片拷过去
            * 否则通过它的资源类型标记为css资源或者js资源，以便spm平台显示不同的缩略图
            * 生成demo.html细节：
            * html、css情况，通过路径读取他们的内容然后写到demo.html即可
            * html，css，js，init.js，通过路径先读取html
            * 4.执行spm doc
            * */

            var packageJsonPath='./package.json';
            var fisConfPath='./fis-conf.js';
            var options = arguments[arguments.length - 1];
            //通过参数配置上传网址
            if(options.inner){
                child = exec('spm config set registry '+options.inner,
                    function (error, stdout, stderr) {
                        if (error !== null) {
                            console.log('exec error: ' + error);
                        }
                    });
            }
            if(options.outer){
                child = exec('spm config set registry '+options.outer,
                    function (error, stdout, stderr) {
                        if (error !== null) {
                            console.log('exec error: ' + error);
                        }
                    });
            }
            if(options.customUrl){
                child = exec('spm config set registry '+options.customUrl,
                    function (error, stdout, stderr) {
                        if (error !== null) {
                            console.log('exec error: ' + error);
                        }
                    });
            }

            if(!fs.existsSync(packageJsonPath)){
                //如果没有预置的package.Json,输出一个
                inquirer.prompt([
                    {
                        type:'input',
                        name:'moduleName',
                        message:'模块名称是（不能有中文）?',
                        default:rootPathInfo.basename,//默认为文件名
                        validate:function(projectName){
                            if(/^[\u2E80-\u9FFF]+$/g.test(projectName)){
                                //如果有汉字
                                return false;
                            }
                            return true;
                        }
                    },
                    {
                        type:'input',
                        name:'moduleVersion',
                        message:'版本号?',
                        default:'0.0.1'
                    },
                    {
                        type:'list',
                        name:'moduleType',
                        message:'模块类型是?',
                        default:'js',
                        choices:['组件','css','js']
                    },
                    {
                        type:'input',
                        name:'moduleMain',
                        message:'模块主入口文件是?',
                        default:'index.js'
                    },
                    {
                        type:'input',
                        name:'moduleDeps',
                        message:'依赖哪些模块?',
                        default:'jquery@1.9.1'
                    }
                ], function( answers ) {
                    fse.outputJsonSync(packageJsonPath, {
                        name: answers.moduleName,
                        version:answers.moduleVersion,
                        description: answers.moduleName,
                        keywords: [
                            answers.moduleName
                        ],
                        homepage: "",
                        author: "snail-team",
                        spm:{
                            main:answers.moduleMain,
                            type:answers.moduleType,
                            dependencies:cwdToObj(answers.moduleDeps),
                            devDependencies: {
                                "expect.js": "0.3.1"
                            }
                        }
                    });
                    if(answers.moduleType=='组件'){
                        generateDemoAndPublish(answers);
                    }else{
                        publish();
                    }
                });

            }else{
                //有预置的package.json
                var packageJson=fse.readJsonSync(packageJsonPath);
                if(!packageJson.spm.type){
                    inquirer.prompt([
                        {
                            type:'list',
                            name:'moduleType',
                            message:'模块类型是?',
                            default:'js',
                            choices:['组件','css','js']
                        }
                    ], function( answers ) {
                        packageJson.spm.type=answers.moduleType;
                        //将spm.dependencies改动写入packageJson
                        fse.writeJsonSync(packageJsonPath, packageJson);
                        if(answers.moduleType=='组件'){
                            generateDemoAndPublish({moduleName:packageJson.name,moduleVersion:packageJson.version});
                        }else{
                            publish();
                        }

                    });
                }else if(packageJson.spm.type=='组件'){
                    generateDemoAndPublish({moduleName:packageJson.name,moduleVersion:packageJson.version});
                }else if(packageJson.spm.type!='组件'){
                    publish();
                }

            }
            function generateDemoAndPublish(answers){
                //console.log(wwwTmpRoot);
                var targetDir=wwwTmpRoot+'/wn-publish-tmp/spm_modules/'+answers.moduleName+'/'+answers.moduleVersion;
                //console.log(targetDir);
                fse.ensureDir(targetDir, function(err) {
                    if(err){
                        console.log(err); // => null
                    }
                    process.chdir(wwwTmpRoot+'/wn-publish-tmp/');
                    //拷贝模块的package.json文件到wwwTmpRoot+'/wn-publish-tmp/'
                    fse.copy(root+'/package.json', wwwTmpRoot+'/wn-publish-tmp/package.json', function(err) {
                        if (err) return console.error(err);
                        //从wn-data下载view模板和配置文件、package.json文件到wwwTmpRoot+'/wn-publish-tmp/
                        console.log('请稍等，正在下载demo模板...');
                        var download = new Download({ extract: true, strip: 1, mode: '755' })
                            //'https://codeload.github.com/snail-team/' +projectAlias[answers.gameType] + '/tar.gz/master'
                            //'https://github.com/snail-team/'+projectAlias[answers.gameType]+'/archive/master.zip'
                            //'https://raw.githubusercontent.com/scrat-team/scrat.js/master/scrat.js'
                            .get('https://github.com/snail-team/wn-module-demo/archive/master.zip')
                            .dest('./')
                            .use(progress());

                        download.run(function (err, files, stream) {
                            if (err) {
                                throw err;
                            }
                            console.log('demo模板已下载完毕!');
                            //执行模板变量替换
                            var viewsFile=wwwTmpRoot+'/wn-publish-tmp/views/index.html';
                            var stat = fs.lstatSync(viewsFile);
                            if(stat.isFile()){
                                var content=fs.readFileSync(viewsFile,'utf8');
                                if(typeof content == 'object'){
                                    content=JSON.stringify(content);
                                }
                                content=content.replace(/\<\%name\%\>/g,answers.moduleName);
                                content=content.replace(/\<\%version\%\>/g,answers.moduleVersion);

                                fs.writeFileSync(viewsFile,content,'utf8');
                            }
                            var fisConfContent;
                            if(options.inner){
                                fisConfContent=fs.readFileSync(fisConfPath,'utf-8');
                                fisConfContent=fisConfContent.replace(/http\:\/\/spm\.woniu\.com/g,options.inner);
                                fs.writeFileSync(fisConfPath,fisConfContent,'utf-8');
                            }
                            if(options.outer){
                                fisConfContent=fs.readFileSync(fisConfPath,'utf-8');
                                fisConfContent=fisConfContent.replace(/http\:\/\/spm\.woniu\.com/g,options.outer);
                                fs.writeFileSync(fisConfPath,fisConfContent,'utf-8');
                            }
                            if(options.customUrl){
                                fisConfContent=fs.readFileSync(fisConfPath,'utf-8');
                                fisConfContent=fisConfContent.replace(/http\:\/\/spm\.woniu\.com/g,options.customUrl);
                                fs.writeFileSync(fisConfPath,fisConfContent,'utf-8');
                            }

                            //安装依赖到wwwTmpRoot+'/wn-publish-tmp/目录里，以便release的是完整的demo
                            child = exec('spm install',
                                function (error, stdout, stderr) {
                                    console.log(stdout);
                                    console.log(stderr);
                                    //依赖模块安装完成后再release
                                    fse.copy(root, targetDir, function(err) {
                                        if (err) return console.error(err);
                                        console.log("开始生成demo！");
                                        //process.chdir(wwwTmpRoot+'/wn-publish-tmp/');
                                        child = exec('wn release -cDo -d '+root,
                                            function (error, stdout, stderr) {
                                                console.log(stdout);
                                                console.log(stderr);
                                                console.log("demo生成成功！");

                                                publish();
                                                if (error !== null) {
                                                    console.log('exec error: ' + error);
                                                }
                                            });
                                    });
                                    if (error !== null) {
                                        console.log('exec error: ' + error);
                                    }
                                });

                        });
                    });

                });
            }
            function publish(){
                //开始生成doc，切换至根目录
                console.log("开始生成doc！");
                process.chdir(root);
                //删除demo缓存文件，以免另一个组件生成demo，文件污染
                fse.removeSync(wwwTmpRoot+'/wn-publish-tmp/');
                child = exec('spm install',
                    function (error, stdout, stderr) {
                        console.log(stdout);
                        console.log(stderr);
                        console.log("模块依赖安装成功！");
                        child = exec('spm doc build',
                            function (error, stdout, stderr) {
                                console.log(stdout);
                                console.log(stderr);
                                console.log("spm doc build成功！");
                                child = exec('spm doc publish',
                                    function (error, stdout, stderr) {
                                        console.log(stdout);
                                        console.log(stderr);
                                        console.log("spm doc publish成功！");
                                        //最好删除spm_modules，不然感觉doc的生成，有点污染源目录,最后上传该模块
                                        if(!options.doc){//如果doc参数不存在则执行spm publish
                                            child = exec('spm publish',
                                                function (error, stdout, stderr) {
                                                    console.log(stdout);
                                                    console.log(stderr);
                                                    console.log("spm publish成功！");

                                                    if (error !== null) {
                                                        console.log('exec error: ' + error);
                                                    }
                                                });
                                        }

                                        if (error !== null) {
                                            console.log('exec error: ' + error);
                                        }
                                    });
                                if (error !== null) {
                                    console.log('exec error: ' + error);
                                }
                            });
                        if (error !== null) {
                            console.log('exec error: ' + error);
                        }
                    });
            }
            function cwdToObj(deps){
                //jquery@1.8.3 nav@0.0.2
                var depsObj={},
                    tmpArr=deps.split(' ');
                for(var i=0;i<tmpArr.length;i++){
                    var module=tmpArr[i];
                    if(module&&module!=''){
                        var moduleName,moduleVersion;
                        if(/@/g.test(module)){
                            moduleName=module.split('@')[0];
                            moduleVersion=module.split('@')[1];
                            depsObj[moduleName]=moduleVersion;
                        }else{
                            moduleName=module;
                            moduleVersion='stable';
                            depsObj[moduleName]=moduleVersion;
                        }

                    }
                }
                return depsObj;//{jquery:'1.8.3',nav:'0.0.2'}
            }
            function initPackageJson(answers){
                //写一个spm发布用的package.json
                console.log('开始生成初始package.json！');

                if(!fs.existsSync(packageJson)){
                    //如果没有预置的package.Json,输出一个
                    fse.outputJsonSync(packageJson, {name: answers.projectName});
                }

            }
            function parsePath(path){
                //判断模块的模块名和版本号情况
                //D:/senro/senro/git/company/wn/wn-site/spm_modules/wn-9yin-nav/0.0.6
                var tmpPath=path.split('/');
                if(/[0-9]*\.[0-9]*\.[0-9]*/g.test(tmpPath[tmpPath.length-1])){
                    //最后的名字是版本号，说明这是个从spm_modules安装的模块
                    return {name:tmpPath[tmpPath.length-2],version:tmpPath[tmpPath.length-1]};
                }else{
                    //最后的名字不是版本号，说明这是个本地模块
                    return {name:tmpPath[tmpPath.length-1],version:''};
                }

            }
 //             var argsStr=getArgsStr();
//            child = exec('spm install '+argsStr,
//                function (error, stdout, stderr) {
//                    console.log('install: ' + stdout);
//                    console.log(stderr);
//                    if (error !== null) {
//                        console.log('exec error: ' + error);
//                    }
//                });
//            function getArgsStr(){
//                var str='';
//                for(var i=0;i<process.argv.length;i++){
//                    if(i>2){
//                        str+=process.argv[i]+' ';
//                    }else if(i==process.argv.length-1){
//                        str+=process.argv[i];
//                    }
//                }
//                return str;
//            }
//            function parseArgs(args){
//                var str={args:'',options:{}};
//                for(var i in args){
//                    if(typeof args[i] == 'string'){
//                        str.args+=args[i]+' ';
//                    }else if(typeof args[i] == 'object'){
//                        str.options=args[i];
//                    }
//                }
//                return str;
//            }

        });
};