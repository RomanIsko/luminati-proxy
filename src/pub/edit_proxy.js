// LICENSE_CODE ZON ISC
'use strict'; /*jslint react:true, es6:true*/
import React from 'react';
import classnames from 'classnames';
import $ from 'jquery';
import _ from 'lodash';
import etask from 'hutil/util/etask';
import ajax from 'hutil/util/ajax';
import setdb from 'hutil/util/setdb';
import {Modal, Loader, Select, Input, Warnings, presets, Link_icon,
    Checkbox, Textarea, Tooltip, Pagination_panel,
    Loader_small} from './common.js';
import Har_viewer from './har_viewer.js';
import util from './util.js';
import zurl from 'hutil/util/url';
import {Typeahead} from 'react-bootstrap-typeahead';
import {Netmask} from 'netmask';
import Pure_component from '../../www/util/pub/pure_component.js';
import {If} from '/www/util/pub/react.js';
import {getContext, withContext} from 'recompose';
import PropTypes from 'prop-types';
import {withRouter} from 'react-router-dom';
import {tabs, all_fields} from './proxy_fields.js';

const provider = provide=>withContext({provide: PropTypes.object},
    ()=>({provide}));
const event_tracker = {};
const ga_event = (category, action, label, opt={})=>{
    const id = category+action+label;
    if (!event_tracker[id] || !opt.single)
    {
        event_tracker[id] = true;
        util.ga_event(category, action, label);
    }
};

const validators = {
    number: (min, max, req=false)=>val=>{
        val = Number(val);
        if (isNaN(val))
        {
            if (req)
                return min;
            else
                return undefined;
        }
        else if (val < min)
            return min;
        else if (val > max)
            return max;
        else
            return val;
    },
    ips_list: val=>{
        val = val.replace(/\s/g, '');
        const ips = val.split(',');
        const res = [];
        ips.forEach(ip=>{
            try { res.push(new Netmask(ip).base); }
            catch(e){ console.log('incorrect ip format'); }
        });
        return res.join(',');
    },
};

const Index = withRouter(class Index extends React.Component {
    constructor(props){
        super(props);
        this.sp = etask('Index', function*(){ yield this.wait(); });
        this.state = {tab: 'logs', form: {zones: {}}, warnings: [],
            errors: {}, show_loader: false, saving: false};
        this.debounced_save = _.debounce(this.save.bind(this), 500);
    }
    componentDidMount(){
        if (!setdb.get('head.proxies_running'))
        {
            const _this = this;
            this.sp.spawn(etask(function*(){
                const proxies_running = yield ajax.json(
                    {url: '/api/proxies_running'});
                setdb.set('head.proxies_running', proxies_running);
            }));
        }
        this.listeners = [
            setdb.on('head.proxies_running', proxies=>{
                if (!proxies||this.state.proxies)
                    return;
                this.port = window.location.pathname.split('/').slice(-1)[0];
                const proxy = proxies.filter(p=>p.port==this.port)[0].config;
                const form = Object.assign({}, proxy);
                setdb.set('head.edit_proxy.form', form);
                const preset = this.guess_preset(form);
                this.apply_preset(form, preset);
                this.setState({proxies}, this.delayed_loader());
            }),
            setdb.on('head.consts',
                consts=>this.setState({consts}, this.delayed_loader())),
            setdb.on('head.defaults',
                defaults=>this.setState({defaults}, this.delayed_loader())),
            setdb.on('head.locations',
                locations=>this.setState({locations}, this.delayed_loader())),
            setdb.on('head.callbacks', callbacks=>this.setState({callbacks})),
            setdb.on('head.edit_proxy.loading', loading=>
                this.setState({loading})),
            setdb.on('head.edit_proxy.tab', (tab='logs')=>
                this.setState({tab})),
        ];
        let state;
        if ((state = this.props.location.state)&&state.field)
            this.goto_field(state.field);
    }
    componentWillUnmount(){
        this.sp.return();
        this.listeners.forEach(l=>setdb.off(l));
        setdb.set('head.edit_proxy.form', undefined);
        setdb.set('head.edit_proxy', undefined);
    }
    delayed_loader(){ return _.debounce(this.update_loader.bind(this)); }
    update_loader(){
        this.setState(state=>{
            const show_loader = !state.consts || !state.locations ||
                !state.proxies || !state.defaults;
            const zone_name = !show_loader&&
                (state.form.zone||state.consts.proxy.zone.def);
            setdb.set('head.edit_proxy.zone_name', zone_name);
            return {show_loader};
        });
    }
    goto_field(field){
        this.init_focus = field;
        let tab;
        for (let [tab_id, tab_o] of Object.entries(tabs))
        {
            if (Object.keys(tab_o.fields).includes(field))
            {
                tab = tab_id;
                break;
            }
        }
        if (tab)
            this.click_tab(tab);
    }
    guess_preset(form){
        let res;
        for (let p in presets)
        {
            const preset = presets[p];
            if (preset.check(form))
            {
                res = p;
                break;
            }
        }
        if (form.last_preset_applied && presets[form.last_preset_applied])
            res = form.last_preset_applied;
        return res;
    }
    click_tab(tab){
        setdb.set('head.edit_proxy.tab', tab);
        ga_event('categories', 'click', tab);
    }
    field_changed(field_name, value){
        this.setState(prev_state=>{
            const new_form = {...prev_state.form, [field_name]: value};
            return {form: new_form};
        }, this.debounced_save);
        setdb.set('head.edit_proxy.form.'+field_name, value);
        this.send_ga(field_name);
    }
    send_ga(id){
        if (id=='zone')
        {
            ga_event('top bar', 'edit field', id);
            return;
        }
        let tab_label;
        for (let t in tabs)
        {
            if (Object.keys(tabs[t].fields).includes(id))
            {
                tab_label = tabs[t].label;
                break;
            }
        }
        ga_event(tab_label, 'edit field', id, {single: true});
    }
    is_valid_field(field_name){
        const proxy = this.state.consts.proxy;
        const form = this.state.form;
        if (!proxy)
            return false;
        if (form.ext_proxies && all_fields[field_name] &&
            !all_fields[field_name].ext)
        {
            return false;
        }
        const zone = form.zone||proxy.zone.def;
        if (['city', 'state'].includes(field_name) &&
            (!form.country||form.country=='*'))
        {
            return false;
        }
        const details = proxy.zone.values.filter(z=>z.value==zone)[0];
        const permissions = details&&details.perm.split(' ')||[];
        const plan = details&&details.plans[details.plans.length-1]||{};
        if (field_name=='vip')
            return !!plan.vip;
        if (field_name=='country'&&(plan.type=='static'||
            ['domain', 'domain_p'].includes(plan.vips_type)))
        {
            return false;
        }
        if (['country', 'state', 'city', 'asn', 'ip'].includes(field_name))
            return permissions.includes(field_name);
        if (field_name=='carrier')
            return permissions.includes('asn');
        return true;
    }
    apply_preset(_form, preset){
        const form = Object.assign({}, _form);
        const last_preset = form.last_preset_applied ?
            presets[form.last_preset_applied] : null;
        if (last_preset&&last_preset.key!=preset&&last_preset.clean)
            last_preset.clean(form);
        if (form.ext_proxies)
        {
            form.preset = '';
            form.zone = '';
            form.password = '';
        }
        else
        {
            form.preset = preset;
            form.last_preset_applied = preset;
            presets[preset].set(form);
        }
        if (form.session===true)
        {
            form.session_random = true;
            form.session = '';
        }
        else
            form.session_random = false;
        if (form.rule)
        {
            form.status_code = form.rule.status;
            form.status_custom = form.rule.custom;
            form.trigger_url_regex = form.rule.url;
            form.trigger_type = form.rule.trigger_type;
            form.body_regex = form.rule.body_regex;
            if (form.rule.min_req_time)
            {
                const min_req_time = form.rule.min_req_time.match(/\d+/);
                form.min_req_time = Number(min_req_time&&min_req_time[0]);
            }
            if (form.rule.max_req_time)
            {
                const max_req_time = form.rule.max_req_time.match(/\d+/);
                form.max_req_time = Number(max_req_time&&max_req_time[0]);
            }
            if (form.rule.action)
            {
                form.action = form.rule.action.value;
                form.retry_port = form.rule.action.raw.retry_port;
                form.retry_number = form.rule.action.raw.retry;
                if (form.rule.action.raw.ban_ip)
                {
                    form.ban_ip_duration = 'custom';
                    const minutes = form.rule.action.raw.ban_ip.match(/\d+/);
                    form.ban_ip_custom = Number(minutes&&minutes[0]);
                }
            }
            delete form.rule;
        }
        if (form.reverse_lookup===undefined)
        {
            if (form.reverse_lookup_dns)
                form.reverse_lookup = 'dns';
            else if (form.reverse_lookup_file)
                form.reverse_lookup = 'file';
            else if (form.reverse_lookup_values)
            {
                form.reverse_lookup = 'values';
                form.reverse_lookup_values = form.reverse_lookup_values
                .join('\n');
            }
        }
        if (!form.ips)
            form.ips = [];
        if (!form.vips)
            form.vips = [];
        if (Array.isArray(form.whitelist_ips))
            form.whitelist_ips = form.whitelist_ips.join(',');
        if (form.city && !Array.isArray(form.city) && form.state)
            form.city = [{id: form.city,
                label: form.city+' ('+form.state+')'}];
        else if (!Array.isArray(form.city))
            form.city = [];
        if (!this.original_form)
            this.original_form = form;
        form.country = (form.country||'').toLowerCase();
        form.state = (form.state||'').toLowerCase();
        this.setState({form});
    }
    default_opt(option){
        const default_label = !!this.state.defaults[option] ? 'Yes' : 'No';
        return [
            {key: 'No', value: false},
            {key: 'Default ('+default_label+')', value: ''},
            {key: 'Yes', value: true},
        ];
    }
    set_errors(_errors){
        const errors = _errors.reduce((acc, e)=>
            Object.assign(acc, {[e.field]: e.msg}), {});
        this.setState({errors, error_list: _errors});
    }
    update_proxies(){
        return etask(function*(){
            const proxies = yield ajax.json({url: '/api/proxies_running'});
            setdb.set('head.proxies_running', proxies);
        });
    }
    save(){
        if (this.saving)
        {
            this.resave = true;
            return;
        }
        const data = this.prepare_to_save();
        const check_url = '/api/proxy_check/'+this.port;
        this.saving = true;
        this.setState({saving: true});
        const _this = this;
        this.sp.spawn(etask(function*(){
            this.on('uncaught', e=>{
                console.log(e);
                ga_event('top bar', 'click save', 'failed');
                _this.setState({error_list: [{msg: 'Something went wrong'}],
                    saving: false});
                _this.saving = false;
                $('#save_proxy_errors').modal('show');
            });
            const raw_check = yield window.fetch(check_url, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(data),
            });
            const json_check = yield raw_check.json();
            const errors = json_check.filter(e=>e.lvl=='err');
            _this.set_errors(errors);
            if (errors.length)
            {
                ga_event('top bar', 'click save', 'failed');
                $('#save_proxy_errors').modal('show');
                _this.setState({saving: false});
                _this.saving = false;
                return;
            }
            const warnings = json_check.filter(w=>w.lvl=='warn');
            if (warnings.length)
                _this.setState({warnings});
            const update_url = '/api/proxies/'+_this.port;
            const raw_update = yield window.fetch(update_url, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({proxy: data}),
            });
            _this.setState({saving: false});
            _this.saving = false;
            if (_this.resave)
            {
                _this.resave = false;
                _this.save();
            }
            _this.update_proxies();
        }));
    }
    prepare_rules(form){
        const action_raw = {};
        if (['retry', 'retry_port', 'ban_ip'].includes(form.action))
            action_raw.retry = true;
        if (form.action=='retry' && form.retry_number)
            action_raw.retry = form.retry_number;
        else if (form.action=='retry_port')
            action_raw.retry_port = form.retry_port;
        else if (form.action=='ban_ip')
        {
            if (form.ban_ip_duration!='custom')
                action_raw.ban_ip = form.ban_ip_duration||'10min';
            else
                action_raw.ban_ip = form.ban_ip_custom+'min';
        }
        else if (form.action=='save_to_pool')
            action_raw.reserve_session = true;
        if (!form.rules)
            form.rules = {};
        if (form.trigger_type)
        {
            form.rules.post = [{
                res: [{
                    head: true,
                    action: action_raw,
                }],
                url: (form.trigger_url_regex||'**'),
            }];
            form.rule = {
                url: form.trigger_url_regex||'**',
                action: {raw: action_raw, value: form.action},
                trigger_type: form.trigger_type,
            };
        }
        else
            form.rule = null;
        if (form.trigger_type=='status')
        {
            let rule_status = form.status_code=='Custom'
                ? form.status_custom : form.status_code;
            rule_status = rule_status||'';
            form.rules.post[0].res[0].status = {type: 'in', arg: rule_status};
            form.rule.status = form.status_code;
            if (form.rule.status=='Custom')
                form.rule.custom = form.status_custom;
        }
        else if (form.trigger_type=='body'&&form.body_regex)
        {
            form.rules.post[0].res[0].body = {type: '=~',
                arg: form.body_regex};
            form.rule.body_regex = form.body_regex;
        }
        else if (form.trigger_type=='min_req_time'&&form.min_req_time)
        {
            form.rules.post[0].res[0].min_req_time = form.min_req_time+'ms';
            form.rule.min_req_time = form.min_req_time+'ms';
        }
        else if (form.trigger_type=='max_req_time'&&form.max_req_time)
        {
            form.rules.post[0].res[0].max_req_time = form.max_req_time+'ms';
            form.rule.max_req_time = form.max_req_time+'ms';
        }
        else if (!form.rules.post && !form.rules.pre)
            form.rules = null;
        delete form.trigger_type;
        delete form.min_req_time;
        delete form.max_req_time;
        delete form.status_code;
        delete form.status_custom;
        delete form.body_regex;
        delete form.action;
        delete form.trigger_url_regex;
        delete form.retry_number;
        delete form.retry_port;
        delete form.ban_ip_duration;
        delete form.ban_ip_custom;
    }
    prepare_to_save(){
        const save_form = Object.assign({}, this.state.form);
        for (let field in save_form)
        {
            let before_save;
            if (before_save = all_fields[field] && all_fields[field].before_save)
                save_form[field] = before_save(save_form[field]);
            if (!this.is_valid_field(field) || save_form[field]===null)
                save_form[field] = '';
        }
        const effective = attr=>{
            return save_form[attr]===undefined ?
                this.state.defaults[attr] : save_form[attr];
        };
        save_form.zone = save_form.zone||this.state.consts.proxy.zone.def;
        save_form.history = effective('history');
        save_form.ssl = effective('ssl');
        save_form.max_requests = effective('max_requests');
        save_form.session_duration = effective('session_duration');
        save_form.keep_alive = effective('keep_alive');
        save_form.pool_size = effective('pool_size');
        save_form.proxy_type = 'persist';
        if (save_form.reverse_lookup=='dns')
            save_form.reverse_lookup_dns = true;
        else
            save_form.reverse_lookup_dns = '';
        if (save_form.reverse_lookup!='file')
            save_form.reverse_lookup_file = '';
        if (save_form.reverse_lookup=='values')
        {
            save_form.reverse_lookup_values =
                save_form.reverse_lookup_values.split('\n');
        }
        else
            save_form.reverse_lookup_values = '';
        delete save_form.reverse_lookup;
        if (save_form.whitelist_ips)
            save_form.whitelist_ips = save_form.whitelist_ips.split(',')
        .filter(Boolean);
        if (save_form.city.length)
            save_form.city = save_form.city[0].id;
        else
            save_form.city = '';
        if (!save_form.max_requests)
            save_form.max_requests = 0;
        delete save_form.rules;
        if (!save_form.ext_proxies)
            presets[save_form.preset].set(save_form);
        this.prepare_rules(save_form);
        delete save_form.preset;
        if (!save_form.session)
            save_form.session = false;
        if (save_form.session_random)
            save_form.session = true;
        if (!save_form.socks)
            save_form.socks = null;
        return save_form;
    }
    get_curr_plan(){
        const zone_name = this.state.form.zone||
            this.state.consts.proxy.zone.def;
        const zones = this.state.consts.proxy.zone.values;
        const curr_zone = zones.filter(p=>p.key==zone_name);
        let curr_plan;
        if (curr_zone.length)
            curr_plan = curr_zone[0].plans.slice(-1)[0];
        return curr_plan;
    }
    render(){
        let Main_window;
        const tab = this.state.tab;
        switch (this.state.tab)
        {
        case 'logs': Main_window = Har_viewer; break;
        case 'target': Main_window = Targeting; break;
        case 'speed': Main_window = Speed; break;
        case 'rules': Main_window = Rules; break;
        case 'rotation': Main_window = Rotation; break;
        case 'debug': Main_window = Debug; break;
        case 'general': Main_window = General; break;
        }
        if (!this.state.consts||!this.state.defaults||!this.state.locations||
            !this.state.proxies)
        {
            Main_window = ()=>null;
        }
        const support = presets && this.state.form.preset &&
            presets[this.state.form.preset].support||{};
        let zones = this.state.consts&&
            this.state.consts.proxy.zone.values||[];
        zones = zones.filter(z=>{
            const plan = z.plans && z.plans.slice(-1)[0] || {};
            return !plan.archive && !plan.disable;
        });
        const default_zone=this.state.consts&&
            this.state.consts.proxy.zone.def;
        const curr_plan = this.state.consts&&this.get_curr_plan();
        let type;
        if (curr_plan&&curr_plan.type=='static')
            type = 'ips';
        else if (curr_plan&&!!curr_plan.vip)
            type = 'vips';
        const port = this.props.match.params.port;
        return (
            <div className="lpm edit_proxy">
              <Loader show={this.state.show_loader||this.state.loading}/>
              <div className="nav_wrapper">
                <div className="nav_header">
                  <h3>Proxy on port {this.port}</h3>
                  <Loader_small show={this.state.saving}/>
                </div>
                <Nav
                  zones={zones}
                  default_zone={default_zone}
                  disabled={!!this.state.form.ext_proxies}
                  form={this.state.form}
                  on_change_field={this.field_changed.bind(this)}
                  on_change_preset={this.apply_preset.bind(this)}
                  save={this.save.bind(this)}/>
                <Nav_tabs
                  curr_tab={this.state.tab}
                  form={this.state.form}
                  on_tab_click={this.click_tab.bind(this)}
                  errors={this.state.errors}/>
              </div>
              <div className={classnames('main_window', {[tab]: true})}>
                <Main_window
                  port={port}
                  proxy={this.state.consts&&this.state.consts.proxy}
                  locations={this.state.locations}
                  defaults={this.state.defaults}
                  form={this.state.form}
                  init_focus={this.init_focus}
                  is_valid_field={this.is_valid_field.bind(this)}
                  on_change_field={this.field_changed.bind(this)}
                  support={support}
                  errors={this.state.errors}
                  default_opt={this.default_opt.bind(this)}
                  get_curr_plan={this.get_curr_plan.bind(this)}
                  goto_field={this.goto_field.bind(this)}/>
              </div>
              <Modal className="warnings_modal" id="save_proxy_errors"
                title="Errors:" no_cancel_btn>
                <Warnings warnings={this.state.error_list}/>
              </Modal>
              <Alloc_modal type={type} form={this.state.form} support={support}
                zone={this.state.form.zone||default_zone}
                on_change_field={this.field_changed.bind(this)}/>
            </div>
        );
    }
});

const Nav = ({disabled, ...props})=>{
    const reset_fields = ()=>{
        // XXX krzysztof: this should be moved in more generic place
        props.on_change_field('ips', []);
        props.on_change_field('vips', []);
        props.on_change_field('multiply_ips', false);
        props.on_change_field('multiply_vips', false);
        props.on_change_field('multiply', 1);
    };
    const update_preset = val=>{
        props.on_change_preset(props.form, val);
        reset_fields();
        ga_event('top bar', 'edit field', 'preset');
    };
    const update_zone = val=>{
        const zone_name = val||props.default_zone;
        setdb.set('head.edit_proxy.zone_name', zone_name);
        const zone = props.zones.filter(z=>z.key==zone_name)[0]||{};
        props.on_change_field('zone', val);
        props.on_change_field('password', zone.password);
        if (props.form.ips.length || props.form.vips.length)
            props.on_change_field('pool_size', 0);
        reset_fields();
    };
    const presets_opt = Object.keys(presets).map(p=>{
        let key = presets[p].title;
        if (presets[p].default)
            key = `Default (${key})`;
        return {key, value: p};
    });
    let {preset} = props.form;
    const preset_tooltip = preset&&presets[preset].subtitle
    +(presets[preset].rules&&
    '<ul>'+presets[preset].rules.map(r=>`<li>${r.label}</li>`).join('')
    +'</ul>');
    return (
        <div className="nav">
          <Field on_change={update_zone} options={props.zones} tooltip="Zone"
            value={props.form.zone} disabled={disabled}/>
          <Field on_change={update_preset} tooltip={preset_tooltip}
            options={presets_opt} value={preset} disabled={disabled}/>
        </div>
    );
};

const Field = ({disabled, tooltip, ...props})=>{
    const options = props.options||[];
    return (
        <Tooltip title={tooltip} placement="bottom">
          <div className="field">
            <select value={props.value} disabled={disabled}
              onChange={e=>props.on_change(e.target.value)}>
              {options.map(o=>(
                <option key={o.key} value={o.value}>{o.key}</option>
              ))}
            </select>
          </div>
        </Tooltip>
    );
};

const Nav_tabs = props=>(
    <div className="nav_tabs">
      <Tab_btn {...props} id="logs"/>
      <Tab_btn {...props} id="target"/>
      <Tab_btn {...props} id="speed"/>
      <Tab_btn {...props} id="rules"/>
      <Tab_btn {...props} id="rotation"/>
      <Tab_btn {...props} id="debug"/>
      <Tab_btn {...props} id="general"/>
    </div>
);

const Tab_btn = props=>{
    const btn_class = classnames('btn_tab',
        {active: props.curr_tab==props.id});
    const tab_fields = Object.keys(tabs[props.id].fields||{});
    const changes = Object.keys(props.form).filter(f=>{
        const val = props.form[f];
        const is_empty_arr = Array.isArray(val) && !val[0];
        return tab_fields.includes(f) && val && !is_empty_arr;
    }).length;
    const errors = Object.keys(props.errors).filter(f=>tab_fields.includes(f));
    return (
        <Tooltip title={tabs[props.id].tooltip}>
          <div onClick={()=>props.on_tab_click(props.id)}
            className={btn_class}>
            <Tab_icon id={props.id} changes={changes}
              error={errors.length}/>
            <div className="title">{tabs[props.id].label}</div>
            <div className="arrow"/>
          </div>
        </Tooltip>
    );
};

const Tab_icon = props=>{
    const circle_class = classnames('circle_wrapper', {
        active: props.error||props.changes, error: props.error});
    const content = props.error ? '!' : props.changes;
    return (
        <div className={classnames('icon', props.id)}>
          <div className={circle_class}>
            <div className="circle">{content}</div>
          </div>
        </div>
    );
};

class Section_raw extends React.Component {
    constructor(props){
        super(props);
        this.state = {focused: false};
    }
    render(){
        const error = !!this.props.error_msg;
        const dynamic_class = {disabled: this.props.disabled};
        return (
            <div className={classnames('section_wrapper', dynamic_class)}>
              <div className="section_body">
                {this.props.children}
              </div>
            </div>
        );
    }
}
const Section = getContext({provide: PropTypes.object})(Section_raw);

const Double_number = props=>{
    const vals = (''+props.val).split(':');
    const update = (start, end)=>{
        props.on_change_wrapper([start||0, end].join(':')); };
    return (
        <span className="double_field">
          <Input {...props} val={vals[0]||''} id={props.id+'_start'}
            type="number" disabled={props.disabled}
            on_change_wrapper={val=>update(val, vals[1])}/>
          <span className="devider">:</span>
          <Input {...props} val={vals[1]||''} id={props.id+'_end'}
            type="number" disabled={props.disabled}
            on_change_wrapper={val=>update(vals[0], val)}/>
        </span>
    );
};

const Typeahead_wrapper = props=>(
    <Typeahead options={props.data} maxResults={10}
      minLength={1} disabled={props.disabled} selectHintOnEnter
      onChange={props.on_change_wrapper} selected={props.val}/>
);

const Section_with_fields = props=>{
    const {id, form, errors, init_focus} = props;
    const disabled = props.disabled || !props.is_valid_field(id);
    const is_empty_arr = Array.isArray(form[id]) && !form[id][0];
    const error_msg = errors[id];
    return (
        <Section disabled={disabled} id={id}
          error_msg={error_msg} init_focus={init_focus}>
          <Section_field {...props} disabled={disabled}/>
        </Section>
    );
};

let Section_field = props=>{
    const {id, form, sufix, note, type, disabled, data, on_change,
        on_change_field, min, max, validator} = props;
    const {tab_id} = props.provide;
    const on_blur = e=>{
        if (validator)
            on_change_field(id, validator(e.target.value));
    };
    const on_change_wrapper = (value, _id)=>{
        const curr_id = _id||id;
        if (on_change)
            on_change(value);
        on_change_field(curr_id, value);
    };
    let Comp;
    switch (type)
    {
    case 'select': Comp = Select; break;
    case 'double_number': Comp = Double_number; break;
    case 'typeahead': Comp = Typeahead_wrapper; break;
    case 'textarea': Comp = Textarea; break;
    default: Comp = Input;
    }
    const val = form[id]===undefined ? '' : form[id];
    const placeholder = tabs[tab_id].fields[id].placeholder||'';
    const tooltip = tabs[tab_id].fields[id].tooltip;
    return (
        <div className={classnames('field_row', {disabled, note})}>
          <div className="desc">
            <Tooltip title={tooltip}>
              {tabs[tab_id].fields[id].label}
            </Tooltip>
          </div>
          <div className="field">
            <div className="inline_field">
              <Comp form={form} id={id} data={data} type={type}
                on_change_wrapper={on_change_wrapper} val={val}
                disabled={disabled} min={min} max={max}
                placeholder={placeholder} on_blur={on_blur}/>
              {sufix ? <span className="sufix">{sufix}</span> : null}
            </div>
            {note ? <Note>{note}</Note> : null}
          </div>
        </div>
    );
};
Section_field = getContext({provide: PropTypes.object})
    (Section_field);

class With_data extends React.Component {
    wrapped_children(){
        const props = Object.assign({}, this.props);
        delete props.children;
        return React.Children.map(this.props.children, child=>{
            return React.cloneElement(child, props); });
    }
    render(){ return <div>{this.wrapped_children()}</div>; }
}

class Targeting_raw extends React.Component {
    constructor(props){
        super(props);
        this.def_value = {key: 'Any (default)', value: ''};
        this.init_carriers();
    }
    init_carriers(){
        const subject = 'Add new carrier option';
        const n = '%0D%0A';
        const body = `Hi,${n}${n}Didn't find the carrier you're looking for?`
        +`${n}${n}Write here the carrier's name: __________${n}${n}We will add`
        +` it in less than 2 business days!`;
        const mail = 'lumext@luminati.io';
        const mailto = `mailto:${mail}?subject=${subject}&body=${body}`;
        this.carriers_note = <a className="link"
                                href={mailto}>More carriers</a>;
        this.carriers = [
            {value: '', key: 'None'},
            {value: 'a1', key: 'A1 Austria'},
            {value: 'aircel', key: 'Aircel'},
            {value: 'airtel', key: 'Airtel'},
            {value: 'att', key: 'AT&T'},
            {value: 'vimpelcom', key: 'Beeline Russia'},
            {value: 'celcom', key: 'Celcom'},
            {value: 'chinamobile', key: 'China Mobile'},
            {value: 'claro', key: 'Claro'},
            {value: 'comcast', key: 'Comcast'},
            {value: 'cox', key: 'Cox'},
            {value: 'dt', key: 'Deutsche Telekom'},
            {value: 'digi', key: 'Digi Malaysia'},
            {value: 'docomo', key: 'Docomo'},
            {value: 'dtac', key: 'DTAC Trinet'},
            {value: 'etisalat', key: 'Etisalat'},
            {value: 'idea', key: 'Idea India'},
            {value: 'kyivstar', key: 'Kyivstar'},
            {value: 'meo', key: 'MEO Portugal'},
            {value: 'megafont', key: 'Megafon Russia'},
            {value: 'mtn', key: 'MTN - Mahanager Telephone'},
            {value: 'mtnza', key: 'MTN South Africa'},
            {value: 'mts', key: 'MTS Russia'},
            {value: 'optus', key: 'Optus'},
            {value: 'orange', key: 'Orange'},
            {value: 'qwest', key: 'Qwest'},
            {value: 'reliance_jio', key: 'Reliance Jio'},
            {value: 'robi', key: 'Robi'},
            {value: 'sprint', key: 'Sprint'},
            {value: 'telefonica', key: 'Telefonica'},
            {value: 'telstra', key: 'Telstra'},
            {value: 'tmobile', key: 'T-Mobile'},
            {value: 'tigo', key: 'Tigo'},
            {value: 'tim', key: 'TIM (Telecom Italia)'},
            {value: 'vodacomza', key: 'Vodacom South Africa'},
            {value: 'vodafone', key: 'Vodafone'},
            {value: 'verizon', key: 'Verizon'},
            {value: 'vivo', key: 'Vivo'},
            {value: 'zain', key: 'Zain'}
        ];
    }
    allowed_countries(){
        const res = this.props.locations.countries.map(c=>
            ({key: c.country_name, value: c.country_id}));
        return [this.def_value, ...res];
    }
    country_changed(){
        this.props.on_change_field('city', []);
        this.props.on_change_field('state', '');
    }
    states(){
        const country = this.props.form.country;
        if (!country||country=='*')
            return [];
        const res = this.props.locations.regions[country].map(r=>
            ({key: r.region_name, value: r.region_id}));
        return [this.def_value, ...res];
    }
    state_changed(){ this.props.on_change_field('city', []); }
    cities(){
        const {country, state} = this.props.form;
        let res;
        if (!country)
            return [];
        res = this.props.locations.cities.filter(c=>c.country_id==country);
        if (state)
            res = res.filter(c=>c.region_id==state);
        const regions = this.states();
        res = res.map(c=>{
            const region = regions.filter(r=>r.value==c.region_id)[0];
            return {label: c.city_name+' ('+region.value+')', id: c.city_name,
                region: region.value};
        });
        return res;
    }
    city_changed(e){
        if (e&&e.length)
            this.props.on_change_field('state', e[0].region);
    }
    render(){
        const curr_plan = this.props.get_curr_plan();
        const show_dc_note = curr_plan&&curr_plan.type=='static';
        const show_vips_note = curr_plan&&
            (curr_plan.vips_type=='domain'||curr_plan.vips_type=='domain_p');
        return (
            <With_data {...this.props}>
              <If when={show_dc_note||show_vips_note}>
                <Note>
                  <If when={show_dc_note}>
                    <span>To change Data Center country visit your </span>
                  </If>
                  <If when={show_vips_note}>
                    <span>To change Exclusive gIP country visit your </span>
                  </If>
                  <a className="link" target="_blank" rel="noopener noreferrer"
                    href="https://luminati.io/cp/zones">zone page</a>
                  <span> and change your zone plan.</span>
                </Note>
              </If>
              <Section_with_fields type="select" id="country"
                data={this.allowed_countries()}
                on_change={this.country_changed.bind(this)}/>
              <Section_with_fields type="select" id="state"
                data={this.states()}
                on_change={this.state_changed.bind(this)}/>
              <Section_with_fields type="typeahead" id="city"
                data={this.cities()}
                on_change={this.city_changed.bind(this)}/>
              <Section_with_fields type="number" id="asn"
                disabled={this.props.form.carrier}/>
              <Section_with_fields type="select" id="carrier"
                data={this.carriers} note={this.carriers_note}
                disabled={this.props.form.asn}/>
            </With_data>
        );
    }
}
const Targeting = provider({tab_id: 'target'})(Targeting_raw);

class Speed_raw extends Pure_component {
    constructor(props){
        super(props);
        this.dns_options = [
            {key: 'Local (default) - resolved by the super proxy',
                value: 'local'},
            {key: 'Remote - resolved by peer', value: 'remote'},
        ];
        this.reverse_lookup_options = [{key: 'No', value: ''},
            {key: 'DNS', value: 'dns'}, {key: 'File', value: 'file'},
            {key: 'Values', value: 'values'}];
    }
    open_modal(){ $('#allocated_ips').modal('show'); }
    get_type(){
        const curr_plan = this.props.get_curr_plan();
        let type;
        if (curr_plan&&curr_plan.type=='static')
            type = 'ips';
        else if (curr_plan&&!!curr_plan.vip)
            type = 'vips';
        return type;
    }
    render(){
        const {form, support} = this.props;
        const pool_size_disabled = !support.pool_size ||
            form.ips.length || form.vips.length;
        const type = this.get_type();
        const render_modal = ['ips', 'vips'].includes(type);
        let pool_size_note;
        if (this.props.support.pool_size&&render_modal)
        {
            pool_size_note = (
                <a className="link"
                  onClick={()=>this.open_modal()}>
                  {'set from allocated '+(type=='ips' ? 'IPs' : 'vIPs')}
                </a>
            );
        }
        return (
            <With_data {...this.props}>
              <Section_with_fields type="select" id="dns"
                data={this.dns_options}/>
              <Section_with_fields type="number" id="pool_size"
                min="0" note={pool_size_note} disabled={pool_size_disabled}/>
              <Section_with_fields type="number" id="request_timeout"
                sufix="seconds" min="0"/>
              <Section_with_fields type="number" id="race_reqs" min="1"
                max="3"/>
              <Section_with_fields type="number" id="proxy_count" min="1"/>
              <Section_with_fields type="number" id="proxy_switch" min="0"/>
              <Section_with_fields type="number" id="throttle" min="0"/>
              <Section id="reverse_lookup">
                <Section_field type="select" id="reverse_lookup"
                  {...this.props} data={this.reverse_lookup_options}/>
                <If when={this.props.form.reverse_lookup=='file'}>
                  <Section_field type="text" id="reverse_lookup_file"
                    {...this.props}/>
                </If>
                <If when={this.props.form.reverse_lookup=='values'}>
                  <Section_field type="textarea" id="reverse_lookup_values"
                    {...this.props}/>
                </If>
              </Section>
            </With_data>
        );
    }
}
const Speed = provider({tab_id: 'speed'})(Speed_raw);

const Note = props=>(
    <div className="note">
      <span>{props.children}</span>
    </div>
);

class Rules_raw extends React.Component {
    constructor(props){
        super(props);
        this.port = window.location.pathname.split('/').slice(-1)[0];
        this.state={
            show_statuses: this.props.form.trigger_type=='status',
            show_body_regex: this.props.form.trigger_type=='body',
            show_min_time: this.props.form.trigger_type=='min_req_time',
            show_max_time: this.props.form.trigger_type=='max_req_time',
            show_custom_status: this.props.form.status_code=='Custom',
        };
    }
    componentWillMount(){
        this.listener = setdb.on('head.proxies_running', proxies=>{
            const ports = (proxies||[]).filter(p=>p.port!=this.port)
            .map(p=>({key: p.port, value: p.port}));
            this.setState({ports});
        });
    }
    componentWillUnmount(){ setdb.off(this.listener); }
    type_changed(val){
        if (val=='status')
            this.setState({show_statuses: true});
        else
        {
            this.setState({show_statuses: false, show_custom_status: false});
            this.props.on_change_field('status_code', '');
            this.props.on_change_field('status_custom', '');
        }
        if (val=='body')
            this.setState({show_body_regex: true});
        else
        {
            this.setState({show_body_regex: false});
            this.props.on_change_field('body_regex', '');
        }
        if (val=='min_req_time')
            this.setState({show_min_time: true});
        else
        {
            this.setState({show_min_time: false});
            this.props.on_change_field('min_req_time', '');
        }
        if (val=='max_req_time')
            this.setState({show_max_time: true});
        else
        {
            this.setState({show_max_time: false});
            this.props.on_change_field('max_req_time', '');
        }
        if (!val)
            this.props.on_change_field('trigger_url_regex', '');
    }
    action_changed(val){
        if (val=='retry_port')
        {
            const def_port = this.state.ports.length&&this.state.ports[0].key;
            this.props.on_change_field(val, def_port||'');
        }
    }
    status_changed(val){
        this.setState({show_custom_status: val=='Custom'});
        if (val!='Custom')
            this.props.on_change_field('status_custom', '');
    }
    render(){
        const disabled = !!this.props.form.ext_proxies;
        const trigger_types = [
            {key: 'i.e. Status code', value: ''},
            {key: 'Status code', value: 'status'},
            {key: 'HTML body element', value: 'body'},
            {key: 'Minimum request time', value: 'min_req_time'},
            {key: 'Maximum request time', value: 'max_req_time'},
        ];
        const action_types = [
            {key: 'i.e. Retry with new IP', value: ''},
            {key: 'Retry with new IP', value: 'retry'},
            {key: 'Retry with new proxy port (Waterfall)',
                value: 'retry_port'},
            {key: 'Ban IP', value: 'ban_ip'},
            {key: 'Save IP to reserved pool', value: 'save_to_pool'},
        ];
        const ban_options = [
            {key: '10 minutes', value: '10min'},
            {key: '20 minutes', value: '20min'},
            {key: '30 minutes', value: '30min'},
            {key: '40 minutes', value: '40min'},
            {key: '50 minutes', value: '50min'},
            {key: 'Custom', value: 'custom'},
        ];
        const status_types = ['i.e. 200 - Succeeded requests',
            '200 - Succeeded requests',
            '403 - Forbidden', '404 - Not found',
            '500 - Internal server error', '502 - Bad gateway',
            '503 - Service unavailable', '504 - Gateway timeout', 'Custom']
            .map(s=>({key: s, value: s}));
        const {form, on_change_field} = this.props;
        return (
            <div>
              <With_data {...this.props} disabled={disabled}>
                <Section id="trigger_type">
                  <Section_field
                    id="trigger_type"
                    form={form}
                    type="select"
                    data={trigger_types}
                    disabled={disabled}
                    on_change_field={on_change_field}
                    on_change={this.type_changed.bind(this)}/>
                  <If when={this.state.show_body_regex}>
                    <Section_field id="body_regex"
                      type="text" {...this.props}/>
                  </If>
                  <If when={this.state.show_min_time}>
                    <Section_field id="min_req_time" type="number"
                    {...this.props} sufix="milliseconds"/>
                  </If>
                  <If when={this.state.show_max_time}>
                    <Section_field id="max_req_time" type="number"
                    {...this.props} sufix="milliseconds"/>
                  </If>
                  <If when={this.state.show_statuses}>
                    <Section_field id="status_code"
                      form={form} type="select" data={status_types}
                      on_change_field={on_change_field}
                      on_change={this.status_changed.bind(this)}/>
                  </If>
                  <If when={this.state.show_custom_status}>
                    <Section_field id="status_custom"
                      form={form} type="text" data={status_types}
                      on_change_field={on_change_field}/>
                  </If>
                  <Section_field id="trigger_url_regex"
                    form={form} type="text"
                    disabled={disabled}
                    on_change_field={on_change_field}/>
                </Section>
                <Section id="action"
                  note="IP will change for every entry"
                  disabled={disabled}
                  on_change_field={on_change_field}>
                  <Section_field id="action"
                    {...this.props}
                    type="select"
                    data={action_types}
                    disabled={disabled}
                    on_change={this.action_changed.bind(this)}/>
                  <If when={this.props.form.action=='retry'}>
                    <Section_field id="retry_number"
                      type="number" {...this.props} min="0" max="20"
                      validator={validators.number(0, 20)}/>
                  </If>
                  <If when={this.props.form.action=='retry_port'}>
                    <Section_field id="retry_port"
                      type="select" data={this.state.ports} {...this.props}/>
                  </If>
                  <If when={this.props.form.action=='ban_ip'}>
                    <Section_field id="ban_ip_duration"
                      type="select" data={ban_options} {...this.props}/>
                    <If when={this.props.form.ban_ip_duration=='custom'}>
                      <Section_field id="ban_ip_custom"
                        type="number" {...this.props} sufix="minutes"/>
                    </If>
                  </If>
                </Section>
              </With_data>
            </div>
        );
    }
}
const Rules = provider({tab_id: 'rules'})(Rules_raw);

class Alloc_modal extends Pure_component {
    constructor(props){
        super(props);
        this.state = {
            available_list: [],
            displayed_list: [],
            cur_page: 0,
            items_per_page: 20,
        };
    }
    componentDidMount(){
        this.setdb_on('head.edit_proxy.zone_name', zone_name=>
            this.setState({available_list: []}));
        this.setdb_on('head.edit_proxy.tab', tab=>
            this.setState({curr_tab: tab}));
        $('#allocated_ips').on('show.bs.modal', this.load.bind(this));
    }
    load(){
        if (this.state.available_list.length)
            return;
        this.loading(true);
        const {form} = this.props;
        const key = form.password||'';
        let endpoint;
        if (this.props.type=='ips')
            endpoint = '/api/allocated_ips';
        else
            endpoint = '/api/allocated_vips';
        const url = zurl.qs_add(window.location.host+endpoint,
            {zone: this.props.zone, key});
        const _this = this;
        this.etask(function*(){
            this.on('uncaught', e=>{
                console.log(e);
                _this.loading(false);
            });
            const res = yield ajax.json({url});
            let available_list;
            if (_this.props.type=='ips')
                available_list = res.ips;
            else
                available_list = res;
            _this.setState({available_list, cur_page: 0}, _this.paginate);
            _this.loading(false);
        });
    }
    paginate(page=-1){
        page = page>-1 ? page : this.state.cur_page;
        const pages = Math.ceil(
            this.state.available_list.length/this.state.items_per_page);
        const cur_page = Math.min(pages, page);
        const displayed_list = this.state.available_list.slice(
            cur_page*this.state.items_per_page,
            (cur_page+1)*this.state.items_per_page);
        this.setState({displayed_list, cur_page});
    }
    loading(loading){
        setdb.set('head.edit_proxy.loading', loading);
        this.setState({loading});
    }
    checked = row=>(this.props.form[this.props.type]||[]).includes(row);
    reset(){
        this.props.on_change_field(this.props.type, []);
        this.props.on_change_field('pool_size', '');
        this.props.on_change_field('multiply', 1);
    }
    toggle(e){
        let {value, checked} = e.target;
        const {type, form, on_change_field} = this.props;
        if (type=='vips')
            value = Number(value);
        let new_alloc;
        if (checked)
            new_alloc = [...form[type], value];
        else
            new_alloc = form[type].filter(r=>r!=value);
        on_change_field(type, new_alloc);
        this.update_multiply_and_pool_size(new_alloc.length);
    }
    select_all(){
        const {type, on_change_field} = this.props;
        on_change_field(type, this.state.available_list);
        this.update_multiply_and_pool_size(this.state.available_list.length);
    }
    update_multiply_and_pool_size(size){
        const {form, on_change_field} = this.props;
        if (!form.multiply_ips && !form.multiply_vips)
            on_change_field('pool_size', size);
        else
        {
            on_change_field('pool_size', 1);
            on_change_field('multiply', size);
        }
    }
    update_items_per_page(items_per_page){
        this.setState({items_per_page}, ()=>this.paginate(0)); }
    page_change(page){ this.paginate(page-1); }
    render(){
        const type_label = this.props.type=='ips' ? 'IPs' : 'vIPs';
        let title;
        if (this.state.curr_tab=='general')
        {
            title = 'Select the '+type_label+' to multiply ('
            +this.props.zone+')';
        }
        else
            title = 'Select the '+type_label+' ('+this.props.zone+')';
        return (
            <Modal id="allocated_ips" className="allocated_ips_modal"
              title={title} no_cancel_btn>
              <Pagination_panel
                entries={this.state.available_list}
                items_per_page={this.state.items_per_page}
                cur_page={this.state.cur_page}
                page_change={this.page_change.bind(this)}
                top
                update_items_per_page={this.update_items_per_page.bind(this)}>
                <Link_icon tooltip="Unselect all"
                  on_click={this.reset.bind(this)} id="unchecked"/>
                <Link_icon tooltip="Select all"
                  on_click={this.select_all.bind(this)} id="check"/>
              </Pagination_panel>
              {this.state.displayed_list.map(row=>
                <Checkbox on_change={this.toggle.bind(this)} key={row}
                  text={row} value={row} checked={this.checked(row)}/>
              )}
              <Pagination_panel
                entries={this.state.available_list}
                items_per_page={this.state.items_per_page}
                cur_page={this.state.cur_page}
                page_change={this.page_change.bind(this)}
                bottom
                update_items_per_page={this.update_items_per_page.bind(this)}>
                <Link_icon tooltip="Unselect all"
                  on_click={this.reset.bind(this)} id="unchecked"/>
                <Link_icon tooltip="Select all"
                  on_click={this.select_all.bind(this)} id="check"/>
              </Pagination_panel>
            </Modal>
        );
    }
}

let Rotation = props=>{
    const {support, form, proxy} = props;
    return (
        <With_data {...props}>
          <Section_with_fields type="text" id="ip"/>
          <Section_with_fields type="text" id="vip"/>
          <Section_with_fields type="select" id="pool_type"
            data={proxy.pool_type.values} disabled={!support.pool_type}/>
          <Section_with_fields type="number" id="keep_alive" min="0"
            disabled={!support.keep_alive}/>
          <Section_with_fields type="text" id="whitelist_ips"
            validator={validators.ips_list}/>
          <Section_with_fields type="select" id="session_random"
            data={props.default_opt('session_random')}/>
          <Section_with_fields type="text" id="session"
            disabled={form.session_random && !support.session}/>
          <Section_with_fields type="select" id="sticky_ip"
            data={props.default_opt('sticky_ip')}
            disabled={!support.sticky_ip}/>
          <Section_with_fields type="double_number" id="max_requests"
            disabled={!support.max_requests}/>
          <Section_with_fields type="double_number" id="session_duration"
            disabled={!support.session_duration}/>
          <Section_with_fields type="text" id="seed" disabled={!support.seed}/>
        </With_data>
    );
};
Rotation = provider({tab_id: 'rotation'})(Rotation);

let Debug = props=>(
    <With_data {...props}>
      <Section_with_fields type="select" id="history"
        data={props.default_opt('history')}/>
      <Section_with_fields type="select" id="ssl"
        data={props.default_opt('ssl')}/>
      <Section_with_fields type="select" id="log"
        data={props.proxy.log.values}/>
      <Section_with_fields type="select" id="debug"
        data={props.proxy.debug.values}/>
    </With_data>
);
Debug = provider({tab_id: 'debug'})(Debug);

let General = props=>{
    const open_modal = ()=>{ $('#allocated_ips').modal('show'); };
    const multiply_changed = val=>{
        const {on_change_field, form} = props;
        const size = Math.max(form.ips.length, form.vips.length);
        if (val)
        {
            on_change_field('pool_size', 1);
            on_change_field('multiply', size);
            open_modal();
            return;
        }
        on_change_field('pool_size', size);
        on_change_field('multiply', 1);
    };
    // XXX krzysztof: cleanup type
    const curr_plan = props.get_curr_plan();
    let type;
    if (curr_plan&&curr_plan.type=='static')
        type = 'ips';
    else if (curr_plan&&!!curr_plan.vip)
        type = 'vips';
    return (
        <With_data {...props}>
          <Section_with_fields type="number" id="port"/>
          <Section_with_fields type="text" id="password"/>
          <Section_with_fields type="number" id="multiply" min="1"
            disabled={!props.support.multiply}/>
          <If when={type=='ips'}>
            <Section_with_fields {...props}
              type="select" id="multiply_ips"
              on_change={multiply_changed}
              data={props.default_opt('multiply_ips')}/>
          </If>
          <If when={type=='vips'}>
            <Section_with_fields {...props}
              type="select" id="multiply_vips"
              on_change={multiply_changed}
              data={props.default_opt('multiply_vips')}/>
          </If>
          <Section_with_fields type="number" id="socks" min="0"/>
          <Section_with_fields type="select" id="secure_proxy"
            data={props.default_opt('secure_proxy')}/>
          <Section_with_fields type="text" id="null_response"/>
          <Section_with_fields type="text" id="bypass_proxy"/>
          <Section_with_fields type="text" id="direct_include"/>
          <Section_with_fields type="text" id="direct_exclude"/>
          <Section_with_fields type="select" id="allow_proxy_auth"
            data={props.default_opt('allow_proxy_auth')}/>
          <Section_with_fields type="select" id="iface"
            data={props.proxy.iface.values}/>
        </With_data>
    );
};
General = provider({tab_id: 'general'})(General);

export default Index;
