extern "C" {#include "jit.common.h"#include "max.jit.mop.h"}typedef struct _max_slitz_pl {	t_object		ob;	void			*obex;} t_max_slitz_pl;t_jit_err slitz_pl_init(void); void *max_slitz_pl_new(t_symbol *s, long argc, t_atom *argv);void max_slitz_pl_free(t_max_slitz_pl *x);maxclass *max_slitz_pl_class;		 	extern "C" void main(void){		void *p,*q;		slitz_pl_init();		setup((messlist **)&max_slitz_pl_class,(method)max_slitz_pl_new, (method)max_slitz_pl_free, (short)sizeof(t_max_slitz_pl), 		0L, A_GIMME, 0);	p = max_jit_classex_setup(calcoffset(t_max_slitz_pl,obex));	q = jit_class_findbyname(gensym("slitz.pl"));        max_jit_classex_mop_wrap(p,q,0); 		//name/type/dim/planecount/bang/outputmatrix/etc    max_jit_classex_standard_wrap(p,q,0); 	//getattributes/dumpout/maxjitclassaddmethods/etc    addmess((method)max_jit_mop_assist, "assist", A_CANT,0);  //standard mop assist fn}void max_slitz_pl_free(t_max_slitz_pl *x){	max_jit_mop_free(x);	jit_object_free(max_jit_obex_jitob_get(x));	max_jit_obex_free(x);}void *max_slitz_pl_new(t_symbol *s, long argc, t_atom *argv){	t_max_slitz_pl *x,*o;	if (x=(t_max_slitz_pl *)max_jit_obex_new(max_slitz_pl_class,gensym("slitz.pl"))) {		if (o=(t_max_slitz_pl *)jit_object_new(gensym("slitz.pl"))) {			max_jit_mop_setup_simple(x,o,argc,argv);						max_jit_attr_args(x,argc,argv);		} else {			error("slitz.pl: could not allocate object");			freeobject((object *)x);		}	}	return (x);}