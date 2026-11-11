"""Validate the complete actual ZIP/directory, including minified React chunks."""
import hashlib,json,pathlib,re,sys,urllib.parse,zipfile

def require(condition, message):
    if not condition:
        raise ValueError(message)

def verify(target, configuration):
    destinations=configuration['staging']; approved=configuration['approved']
    path=pathlib.Path(target)
    if path.is_dir():
        files={p.relative_to(path).as_posix():p.read_bytes() for p in path.rglob('*') if p.is_file()}
    else:
        with zipfile.ZipFile(path) as archive:
            require(archive.testzip() is None, 'Invalid ZIP CRC')
            names=[i.filename for i in archive.infolist() if not i.is_dir()]
            require(len(names)==len(set(names)), 'Duplicate ZIP entries')
            files={name:archive.read(name) for name in names}
    for name in files:
        parts=pathlib.PurePosixPath(name).parts
        require(not name.startswith(('/', '\\')) and '..' not in parts and ':' not in name, 'Unsafe artifact path')
        require(not any(p in ['node_modules','validation','screenshots','archive'] or p.startswith('.env') for p in parts), 'Private/test content in artifact')
    manifest=json.loads(files['release-manifest.json'])
    require(manifest.get('productionOnly') is True, 'Missing production-only build marker')
    require(set(files)==set(manifest['files'])|{'release-manifest.json'}, 'Manifest inventory mismatch')
    for name,expected in manifest['files'].items():
        require(hashlib.sha256(files[name]).hexdigest()==expected, 'Manifest hash mismatch: '+name)
    for required in ['index.html','auth-callback.html','runtime/environment-policy.js','runtime/auth-config-705b-r3.js','scripts/auth-session-705b-r3.js','scripts/saved-trips-705c.js','scripts/saved-trips-705c-r3-route-details.js','react/account/index.html','react/my-trips/index.html','react/travel-profile/index.html','react/journey/index.html']:
        require(required in files, 'Missing asset: '+required)
    failures=[]
    for name,content in files.items():
        text=content.decode('utf-8',errors='replace').replace('\\/','/')
        for label,value in destinations.items():
            if value in text or urllib.parse.quote(value,safe='') in text:
                failures.append(name+': '+label)
    require(not failures, 'Staging destinations in artifact: '+', '.join(failures))
    unapproved=[]
    patterns=[
        ('API', r'https?://[a-z0-9-]+\.lambda-url\.[a-z0-9-]+\.on\.aws', approved['apiBaseUrl']),
        ('Cognito login', r'https?://[a-z0-9-]+\.auth\.[a-z0-9-]+\.amazoncognito\.com', approved['auth']['domainBaseUrl']),
        ('Cognito issuer', r'https?://cognito-idp\.[a-z0-9-]+\.amazonaws\.com/[A-Za-z0-9_-]+', approved['auth']['issuer']),
        ('Cognito pool', r'\b[a-z]{2}-[a-z]+-\d_[A-Za-z0-9]+', approved['auth']['userPoolId']),
        ('Cognito client', r"[\"']?client(?:Id|_id)[\"']?\s*[:=]\s*[\"']([a-z0-9]{12,64})[\"']", approved['auth']['clientId'])
    ]
    for name,content in files.items():
        text=urllib.parse.unquote(content.decode('utf-8',errors='replace').replace('\\/','/'))
        for label,pattern,expected in patterns:
            if any(value!=expected for value in re.findall(pattern,text)):
                unapproved.append(name+': '+label)
    require(not unapproved, 'Unapproved API/Cognito destinations in artifact: '+', '.join(unapproved))
    return {'verified':True,'files':len(files),'compiledReactChunks':sum(n.startswith('react/') and n.endswith('.js') for n in files),'stagingDestinationsFound':False,'unapprovedApiOrCognitoDestinationsFound':False,'manifestHashesVerified':True}

if __name__=='__main__':
    try:
        print(json.dumps(verify(sys.argv[1],json.load(sys.stdin))))
    except Exception as error:
        print(str(error),file=sys.stderr)
        sys.exit(1)
