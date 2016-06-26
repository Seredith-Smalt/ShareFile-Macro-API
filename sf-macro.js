// This is a stateless macro-level API handler for the ShareFile API.
// Adolfo Rodriguez, Keith Lindsay
// Trace conventions:
//  -X-> means a message was received from X where X={C,S,B} representing {client, security server, back-end server} respectively

var fs = require('fs');
var express = require('express');
var https = require('https');
var querystring = require('querystring');
var app = express();
var files_client = require("./endpoints/sf-files");
var users_client = require("./endpoints/sf-users");
var groups_client = require("./endpoints/sf-groups");
var stream_client = require("./endpoints/sf-streams");
var sfauth = require("./sf-authenticate");
var bodyParser = require('body-parser');
var crypto = require("crypto");
var redis = require("redis");
var beautify = require("js-beautify").js_beautify;

var redis_path = '/home/azureuser/citrix/ShareFile-env/sf-redis.js'; // used to specify a redis server
if (fs.existsSync(redis_path)) {
    var redis_info = require(redis_path);
    console.log ("Using this Redis server: " + JSON.stringify(redis_info));
    var redclient = redis.createClient(redis_info.redis_host);
} else  //  try to connect to a local host
    var redclient = redis.createClient({port:5001});


app.set('port', (process.env.PORT || 8080 ));

app.use(express.static(__dirname + '/public'));

var my_options = {  // request options
    hostname: 'zzzz.sf-api.com',
    port: '443',
    path: '',
    method: 'GET',
};

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

function getDateTime() {
    var date = new Date();

    var hour = date.getHours();
    hour = (hour < 10 ? "0" : "") + hour;

    var min  = date.getMinutes();
    min = (min < 10 ? "0" : "") + min;

    var sec  = date.getSeconds();
    sec = (sec < 10 ? "0" : "") + sec;

    var year = date.getFullYear();

    var month = date.getMonth() + 1;
    month = (month < 10 ? "0" : "") + month;

    var day  = date.getDate();
    day = (day < 10 ? "0" : "") + day;

    return year + ":" + month + ":" + day + ":" + hour + ":" + min + ":" + sec;
}

function generateFileHash(req){
    var current_date = (new Date()).valueOf().toString();
    var random = Math.random().toString();
    var hashcode = crypto.createHash('sha1').update(current_date + random).digest('hex');
    if (req.query.hashcode){
        console.log(hashcode);
        hashcode = req.query.hashcode;
    } else {
        var json_key = hashcode +'-json';
        var method_key = hashcode +'-method';
        //preserve body information for after authentication                                                                             
	redclient.set(method_key, req.method);
        redclient.set(json_key, JSON.stringify(req.body));
    }

    return hashcode;
}

function retrieveMethod(req) {
    if (req.query.hashcode){
	hashcode = req.query.hashcode;
        var method_key = hashcode +'-method';
	redclient.get(method_key, function(err, method_info) {
            return method_info.toString();
	});
    } else {
	return req.method;
    }
}

function retrieveBody(req) {
    if (req.query.hashcode){
        hashcode = req.query.hashcode;
	var json_key = hashcode +'-json';
	redclient.get(json_key, function(err, json_info) {
	    return json_info.toString();
	});
    } else {
	return JSON.stringify(req.body);
    }
}

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}


function buildNewPath(request_path) {
    var new_path = '';

    var middle = querystring.unescape(request_path);
    var file_array = middle.split("/");
    
    for (var i=1; i< file_array.length; i++) {
	// console.log ("Processing element "+i+ ":" + file_array[i]);
	var replace_val = querystring.escape(querystring.unescape(file_array[i]));
	if (file_array[i] != replace_val) {
	    // console.log ("Replacing " + file_array[i] + " with " + replace_val);
	    file_array[i] = replace_val;
	}
	new_path = new_path + '/'+file_array[i];
    }
    return new_path;
}

app.options('*', function(request, response) {
    console.log ("-C-> OPTIONS "+request.path+" ["+JSON.stringify(request.headers)+"]");

    response.status(200);
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    response.setHeader('Access-Control-Max-Age', 10);
    response.setHeader('Accept-Language', 'en-US');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Connection', 'close');
    console.log("<-C- OPTIONS");
    response.send();
    response.end();
});

app.all('/files*', function(request, response) {
    console.log("------/files----------"+getDateTime()+"-------------");
    console.log ("-C-> "+request.method+" "+request.path);

    var new_path = buildNewPath(request.path);
    console.log ("Path in: " + request.path + "  Cleaned path: " + new_path);
    request.path = new_path;
    var file_array = new_path.split("/");
    
    // Note: the first element in the array should be '' since the string starts with a '/'        
    if (file_array[1].toLowerCase() != 'files') {  // error, some funky request came in
        console.log("<-C- File not found: " + request.path);
        response.status(404);
        response.send('Not Found: ' + request.path);
        return;
    }

    sfauth.set_security (request, response, my_options, new_path, function(set_options, cookie) {
	if (request.method == 'DELETE')
            files_client.delete_file (file_array, new_path, request, response, set_options, cookie);
	else if (request.method == 'GET')
	    files_client.get_file (file_array, new_path, request, response, set_options, cookie);
	else if (request.method == 'POST')
	    files_client.post_file (file_array, new_path, request, response, set_options, cookie);
    });
});

app.post('/streams/create*', function(request, response) {
    console.log ("-C-> "+request.method+" "+request.path);
    var new_path = buildNewPath(request.path);
    console.log ("Path in: " + request.path + "  Cleaned path: " + new_path);
    request.path = new_path;
    var file_array = new_path.split("/");

    sfauth.set_security (request, response, my_options, new_path, function(set_options, cookie) {
	stream_client.create_stream(file_array, new_path, request, response, set_options, cookie);
    });

});

app.all('/streams/:id*', function(request, response) {
    console.log ("-C-> "+request.method+" "+request.path);
    var new_path = buildNewPath(request.path);
    console.log ("Path in: " + request.path + "  Cleaned path: " + new_path);
    request.path = new_path;
    var file_array = new_path.split("/");

    sfauth.set_security (request, response, my_options, new_path, function(set_options, cookie) {
        var id = request.params.id;
	if (request.method == 'DELETE')
            stream_client.delete_stream (id, new_path, request, response, set_options, cookie);
        else if (request.method == 'GET')
            stream_client.get_stream (id, new_path, request, response, set_options, cookie);
        else if (request.method == 'POST')
            stream_client.save_stream (id, new_path, request, response, set_options, cookie);
	else if (request.method == 'PATCH')
	    stream_client.update_stream (id, new_path, request, response, set_options, cookie);
    });
});

app.all('/*/:id', function(req, res) {
    console.log("------/*/:id----------"+getDateTime()+"-------------");
    console.log(req.path);
    sfauth.set_security (req, res, my_options, req.url, function(set_options, cookie) {
        var id = req.params.id;
        var req_array = req.path.split("/");
        var sub_nav = "";
        if (req_array[3]) {
            sub_nav = "/" + req_array[3];
        }
        set_options.method = retrieveMethod(req);
        var body = retrieveBody(req);
       
        if (body) {
            set_options.headers['Content-Length'] = Buffer.byteLength(body);
        }
	var entity = capitalizeFirstLetter(req_array[1]);
        var url_path = '/sf/v3/' + entity + '(' + id + ')' + sub_nav;
        console.log("ID: " + id);
	console.log(url_path);
        set_options.path = url_path
       //set_options.hostname = set_options.headers.Host;                                                                                
        console.log("<-B-: " + JSON.stringify(set_options));
       
        var api_request = https.request(set_options, function(api_response) {
	    var resultString = "";
	    console.log(api_response.statusCode);
            api_response.on('data', function (chunk) {
                resultString+=chunk;
            });
            api_response.on('end', function (chunk) {
                console.log("-B->: [" + api_response.statusCode + "] : [" + JSON.stringify(api_response.headers) + "]");


                res.setHeader('Access-Control-Allow-Origin', '*');
                res.status(200);
                res.setHeader('content-type', 'application/json');
                res.send(beautify(resultString));
                res.end();
            });       
        });
        if (body) {
            api_request.write(body);
        }
        api_request.end();

        return;
    });
});

app.all('/*', function(req, res) {
    console.log("------/*----------"+getDateTime()+"-------------");
    sfauth.set_security (req, res, my_options, req.url, function(set_options, cookie) {
        set_options.method = retrieveMethod(req);
        var body = retrieveBody(req);
        if (body) {
            set_options.headers['Content-Length'] = Buffer.byteLength(body);

        }
        var entity = capitalizeFirstLetter(req.url);
        var url_path = '/sf/v3' + entity;
        console.log(url_path);
        set_options.path = url_path
        console.log("<-B-: " + JSON.stringify(set_options));
        var resultString = "";
        var api_request = https.request(set_options, function(api_response) {
            console.log(api_response.statusCode);
            api_response.on('data', function (chunk) {
                        resultString+=chunk;
                    });
            api_response.on('end', function (chunk) {
                console.log("-B->: [" + api_response.statusCode + "] : [" + JSON.stringify(api_response.headers) + "]");


                res.setHeader('Access-Control-Allow-Origin', '*');
                res.status(200);
                res.setHeader('content-type', 'application/json');
                res.send(beautify(resultString));
                res.end();
            });
        });
        if (body) {
            api_request.write(body);
        }
        api_request.end();
        return;
    });
});

app.get('/allusers', function(request, response) {
    console.log ("-C-> GET "+request.path);
    var user_array = request.path.split("/");

    // Note: the first element in the array should be '' since the string starts with a '/'  
    if (user_array[1] != 'allusers') {  // error, some funky request came in     
        console.log("<-C- Users not found: " + request.path);
        response.status(404);
        response.send('Not Found: ' + request.path);
        return;
    }

	var user_type = request.query.userType;
	sfauth.set_security (request, response, my_options, request.path, function(set_options, cookie) {
            users_client.get_user_list (user_type, request, response, set_options, cookie);
	});
   
});


app.listen(app.get('port'), function() {
    console.log("Node app is running at localhost:" + app.get('port'));
});
